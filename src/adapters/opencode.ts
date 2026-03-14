import { spawn, execFileSync } from 'child_process';
import type { AgentAdapter, AgentResult } from './adapter.js';
import { trackProcess } from '../lifecycle.js';
import { detectInputPrompt, extractPromptText } from './prompt-detection.js';

export class OpenCodeAdapter implements AgentAdapter {
  name = 'opencode';

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync('which', ['opencode'], { encoding: 'utf-8', stdio: 'pipe' });
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
      const args = ['--non-interactive', opts.prompt];
      if (opts.images) {
        for (const img of opts.images) {
          args.push('--image', img);
        }
      }

      const proc = spawn('opencode', args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
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
        if (stdout.length + text.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.slice(stdout.length + text.length - MAX_OUTPUT_SIZE) + text;
        } else {
          stdout += text;
        }
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
        if (stderr.length + errText.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(stderr.length + errText.length - MAX_OUTPUT_SIZE) + errText;
        } else {
          stderr += errText;
        }
      });

      const timer =
        timeout > 0
          ? setTimeout(() => {
              settled = true;
              proc.kill('SIGTERM');
              reject(new Error(`OpenCode timed out after ${timeout}ms`));
            }, timeout)
          : null;

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (settled) return;
        settled = true;
        resolve({
          output: stdout || stderr,
          exitCode: code ?? 1,
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
    });
  }
}
