import { spawn, execFileSync } from 'child_process';
import type { AgentAdapter, AgentResult } from './adapter.js';
import { trackProcess } from '../lifecycle.js';
import { detectInputPrompt, extractPromptText } from './prompt-detection.js';

/** Return a minimal environment for child processes to avoid leaking secrets. */
function safeEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
}

export class CodexAdapter implements AgentAdapter {
  name = 'codex';

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync('which', ['codex'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  execute(opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    sessionId?: string;
    images?: string[];
    onOutput?: (chunk: string) => void;
    onInputNeeded?: (promptText: string) => Promise<string | null>;
  }): Promise<AgentResult> {
    const timeout = opts.timeout ?? 0;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const args = ['-q'];
      if (opts.images) {
        for (const img of opts.images) {
          args.push('--image', img);
        }
      }

      const proc = spawn('codex', args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv(),
      });
      trackProcess(proc, opts.sessionId);

      const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      let recentOutput = '';
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let waitingForInput = false;
      let settled = false;

      // Silence EPIPE but log other stdin errors
      proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') {
          console.error(`stdin error: ${err.message}`);
        }
      });

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const combinedStdout = stdout + text;
        stdout =
          combinedStdout.length > MAX_OUTPUT_SIZE
            ? combinedStdout.slice(combinedStdout.length - MAX_OUTPUT_SIZE)
            : combinedStdout;
        if (opts.onOutput) {
          opts.onOutput(text);
        }

        if (!opts.onInputNeeded) return;

        recentOutput += text;
        if (recentOutput.length > 500) {
          recentOutput = recentOutput.slice(-500);
        }

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (waitingForInput || settled) return;
          const captured = recentOutput;
          recentOutput = '';
          if (detectInputPrompt(captured)) {
            waitingForInput = true;
            const promptText = extractPromptText(captured);
            opts.onInputNeeded!(promptText)
              .then((response) => {
                waitingForInput = false;
                if (response !== null && !proc.killed) {
                  proc.stdin.write(response + '\n');
                }
              })
              .catch(() => {
                waitingForInput = false;
              });
          }
        }, 2000);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const errText = chunk.toString();
        const combinedStderr = stderr + errText;
        stderr =
          combinedStderr.length > MAX_OUTPUT_SIZE
            ? combinedStderr.slice(combinedStderr.length - MAX_OUTPUT_SIZE)
            : combinedStderr;
      });

      const timer =
        timeout > 0
          ? setTimeout(() => {
              settled = true;
              proc.stdout.removeAllListeners('data');
              proc.stderr.removeAllListeners('data');
              proc.kill('SIGTERM');
              reject(new Error(`Codex timed out after ${timeout}ms`));
            }, timeout)
          : null;

      proc.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (settled) return;
        settled = true;
        resolve({
          output: stdout || stderr,
          exitCode: code ?? (signal ? 128 : 1),
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (settled) return;
        settled = true;
        reject(err);
      });

      // Pass prompt via stdin instead of CLI arg to avoid ARG_MAX overflow
      proc.stdin.write(opts.prompt);
      proc.stdin.end();
    });
  }
}
