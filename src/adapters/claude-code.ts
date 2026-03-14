import { spawn, execFileSync } from 'child_process';
import type { AgentAdapter, AgentResult } from './adapter.js';
import { trackProcess } from '../lifecycle.js';

/**
 * Format a tool_use block into a short progress line for the AgentPanel.
 */
function formatToolProgress(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `  Read ${input.file_path ?? ''}`;
    case 'Write':
      return `  Write ${input.file_path ?? ''}`;
    case 'Edit':
      return `  Edit ${input.file_path ?? ''}`;
    case 'Bash': {
      const cmd = String(input.command ?? '');
      return `  Bash: ${cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd}`;
    }
    case 'Glob':
      return `  Glob ${input.pattern ?? ''}`;
    case 'Grep':
      return `  Grep ${input.pattern ?? ''}`;
    default:
      return `  ${toolName}`;
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync('which', ['claude'], { encoding: 'utf-8', stdio: 'pipe' });
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
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
      ];
      if (opts.images) {
        for (const img of opts.images) {
          args.push('--image', img);
        }
      }

      const proc = spawn('claude', args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      trackProcess(proc, opts.sessionId);

      const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
      let accumulatedText = '';
      let resultText: string | null = null;
      let stderr = '';
      let lineBuffer = '';
      let settled = false;

      // Silence EPIPE but log other stdin errors
      proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') {
          console.error(`stdin error: ${err.message}`);
        }
      });

      function processLine(line: string) {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Non-JSON line — treat as raw text (backward compat)
          const rawLine = line + '\n';
          if (accumulatedText.length + rawLine.length > MAX_OUTPUT_SIZE) {
            accumulatedText =
              accumulatedText.slice(accumulatedText.length + rawLine.length - MAX_OUTPUT_SIZE) +
              rawLine;
          } else {
            accumulatedText += rawLine;
          }
          // Log if it looks like an error message
          if (/^(error:|Error:|fatal:|Authentication|not found)/i.test(trimmed)) {
            console.error(`claude-code non-JSON error output: ${trimmed}`);
          }
          if (opts.onOutput) opts.onOutput(line + '\n');
          return;
        }

        const type = parsed.type as string | undefined;

        if (type === 'assistant') {
          const message = parsed.message as Record<string, unknown> | undefined;
          if (!message) return;
          const content = message.content as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(content)) return;

          for (const block of content) {
            if (block.type === 'tool_use') {
              const toolName = block.name as string;
              const input = (block.input ?? {}) as Record<string, unknown>;
              const progressLine = formatToolProgress(toolName, input);
              if (opts.onOutput) opts.onOutput(progressLine + '\n');
            } else if (block.type === 'text') {
              // Accumulate text silently — don't send to panel
              const blockText = (block.text as string) ?? '';
              if (accumulatedText.length + blockText.length > MAX_OUTPUT_SIZE) {
                accumulatedText =
                  accumulatedText.slice(
                    accumulatedText.length + blockText.length - MAX_OUTPUT_SIZE,
                  ) + blockText;
              } else {
                accumulatedText += blockText;
              }
            }
          }
        } else if (type === 'result') {
          // Final result — use parsed.result as the response text
          resultText = (parsed.result as string) ?? '';
        }
        // Ignore system, user, and other event types
      }

      proc.stdout.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        lineBuffer += data;

        // Split into complete lines
        const lines = lineBuffer.split('\n');
        // Last element is incomplete — keep in buffer
        lineBuffer = lines.pop()!;

        for (const line of lines) {
          processLine(line);
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length + text.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(stderr.length + text.length - MAX_OUTPUT_SIZE) + text;
        } else {
          stderr += text;
        }
      });

      const timer =
        timeout > 0
          ? setTimeout(() => {
              settled = true;
              proc.kill('SIGTERM');
              reject(new Error(`Claude Code timed out after ${timeout}ms`));
            }, timeout)
          : null;

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;

        // Flush remaining line buffer
        if (lineBuffer.trim()) {
          processLine(lineBuffer);
          lineBuffer = '';
        }

        const finalOutput = resultText ?? (accumulatedText || stderr);

        resolve({
          output: finalOutput,
          exitCode: code ?? 1,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      });

      // Write prompt and immediately close stdin so `claude -p` sees EOF
      // and starts processing. Pipe mode reads stdin to completion before
      // executing — keeping stdin open causes the process to hang.
      proc.stdin.write(opts.prompt);
      proc.stdin.end();
    });
  }
}
