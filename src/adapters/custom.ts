import { spawn, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, unlinkSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentAdapter, AgentResult } from './adapter.js';
import type { AgentConfig } from '../config/loader.js';
import { trackProcess } from '../lifecycle.js';
import { detectInputPrompt, extractPromptText } from './prompt-detection.js';

/** Return a minimal environment for child processes to avoid leaking secrets. */
function safeEnv(extraEnv?: Record<string, string>): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    ...extraEnv,
  };
}

export class CustomAdapter implements AgentAdapter {
  name: string;
  private config: AgentConfig;

  constructor(name: string, config: AgentConfig) {
    this.name = name;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync('which', [this.config.command], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
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
    const promptVia = this.config.prompt_via ?? 'stdin';
    const outputFrom = this.config.output_from ?? 'stdout';

    return new Promise((resolve, reject) => {
      const args = [...(this.config.args ?? [])];
      if (opts.images) {
        for (const img of opts.images) {
          args.push('--image', img);
        }
      }
      let promptFile: string | undefined;

      if (promptVia === 'arg') {
        args.push(opts.prompt);
      } else if (promptVia === 'file') {
        promptFile = join(tmpdir(), `sweteam-prompt-${randomUUID()}.txt`);
        writeFileSync(promptFile, opts.prompt, { mode: 0o600 });
        args.push(promptFile);
      }

      const proc = spawn(this.config.command, args, {
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
      let stdinEnded = false;

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

      const cleanup = () => {
        if (promptFile) {
          try {
            unlinkSync(promptFile);
          } catch {
            /* file may already be removed */
          }
        }
      };

      const timer =
        timeout > 0
          ? setTimeout(() => {
              settled = true;
              proc.stdout.removeAllListeners('data');
              proc.stderr.removeAllListeners('data');
              proc.kill('SIGTERM');
              cleanup();
              reject(new Error(`${this.name} timed out after ${timeout}ms`));
            }, timeout)
          : null;

      // Ensure stdin is closed when the process exits, preventing fd leak
      // when promptVia='file' and onInputNeeded keeps stdin open
      proc.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);

        // Always close stdin if it hasn't been ended yet
        if (!stdinEnded && !proc.stdin.destroyed) {
          try {
            proc.stdin.end();
          } catch {
            /* already closed */
          }
          stdinEnded = true;
        }

        if (settled) {
          cleanup();
          return;
        }
        settled = true;

        let output = stdout || stderr;

        if (outputFrom === 'file') {
          const outputFile = join(opts.cwd, '.sweteam-output.txt');
          try {
            // Check for symlink attack before reading
            const stat = lstatSync(outputFile);
            if (stat.isSymbolicLink()) {
              console.warn(
                `Skipping output file ${outputFile}: is a symlink (possible symlink attack)`,
              );
            } else {
              output = readFileSync(outputFile, 'utf-8');
              unlinkSync(outputFile);
            }
          } catch {
            /* file may not exist */
          }
        }

        cleanup();
        resolve({
          output,
          exitCode: code ?? (signal ? 128 : 1),
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });

      if (promptVia === 'stdin') {
        proc.stdin.write(opts.prompt);
        // If onInputNeeded is provided, keep stdin open for interactive responses
        if (!opts.onInputNeeded) {
          proc.stdin.end();
          stdinEnded = true;
        }
      } else {
        // For arg/file prompt modes, close stdin unless interactive input is expected
        if (!opts.onInputNeeded) {
          proc.stdin.end();
          stdinEnded = true;
        }
      }
    });
  }
}
