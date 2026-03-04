import { spawn, execFileSync } from "child_process";
import type { AgentAdapter, AgentResult } from "./adapter.js";
import { trackProcess } from "../lifecycle.js";
import { detectInputPrompt, extractPromptText } from "./prompt-detection.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  name = "claude-code";

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync("which", ["claude"], { encoding: "utf-8", stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  execute(opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
    onInputNeeded?: (promptText: string) => Promise<string | null>;
  }): Promise<AgentResult> {
    const timeout = opts.timeout ?? 0;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const proc = spawn("claude", ["-p"], {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      trackProcess(proc);

      let stdout = "";
      let stderr = "";

      // Buffer for prompt detection (last 500 chars of output)
      let recentOutput = "";
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let waitingForInput = false;

      function onOutputChunk(text: string) {
        stdout += text;
        if (opts.onOutput) {
          opts.onOutput(text);
        }

        if (!opts.onInputNeeded) return;

        // Buffer recent output for prompt detection
        recentOutput += text;
        if (recentOutput.length > 500) {
          recentOutput = recentOutput.slice(-500);
        }

        // Reset debounce timer on each output chunk
        if (debounceTimer) clearTimeout(debounceTimer);

        // After 2s of output stall, check for prompt
        debounceTimer = setTimeout(() => {
          if (waitingForInput) return;
          if (detectInputPrompt(recentOutput)) {
            waitingForInput = true;
            const promptText = extractPromptText(recentOutput);
            opts.onInputNeeded!(promptText).then((response) => {
              waitingForInput = false;
              if (response !== null && !proc.killed) {
                proc.stdin.write(response + "\n");
              }
              recentOutput = "";
            });
          }
        }, 2000);
      }

      proc.stdout.on("data", (chunk: Buffer) => {
        onOutputChunk(chunk.toString());
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        // Stream stderr too so the user sees errors/progress
        if (opts.onOutput) {
          opts.onOutput(text);
        }
      });

      const timer = timeout > 0 ? setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Claude Code timed out after ${timeout}ms`));
      }, timeout) : null;

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        resolve({
          output: stdout || stderr,
          exitCode: code ?? 1,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        reject(err);
      });

      proc.stdin.write(opts.prompt);

      // If onInputNeeded is provided, keep stdin open so we can pipe responses.
      // Otherwise, close stdin immediately (backward compat).
      if (!opts.onInputNeeded) {
        proc.stdin.end();
      } else {
        // Close stdin when the process exits
        proc.on("close", () => {
          if (!proc.stdin.destroyed) {
            proc.stdin.end();
          }
        });
      }
    });
  }
}
