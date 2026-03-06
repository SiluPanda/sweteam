import { spawn, execFileSync } from "child_process";
import type { AgentAdapter, AgentResult } from "./adapter.js";
import { trackProcess } from "../lifecycle.js";
import { detectInputPrompt, extractPromptText } from "./prompt-detection.js";

export class OpenCodeAdapter implements AgentAdapter {
  name = "opencode";

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync("which", ["opencode"], { encoding: "utf-8", stdio: "pipe" });
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
    onOutput?: (chunk: string) => void;
    onInputNeeded?: (promptText: string) => Promise<string | null>;
  }): Promise<AgentResult> {
    const timeout = opts.timeout ?? 0;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const proc = spawn("opencode", ["--non-interactive", opts.prompt], {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      trackProcess(proc, opts.sessionId);

      let stdout = "";
      let stderr = "";
      let recentOutput = "";
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let waitingForInput = false;
      let settled = false;

      // Prevent EPIPE crashes
      proc.stdin.on("error", () => {});

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
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
          if (detectInputPrompt(recentOutput)) {
            waitingForInput = true;
            const promptText = extractPromptText(recentOutput);
            opts.onInputNeeded!(promptText).then((response) => {
              waitingForInput = false;
              if (response !== null && !proc.killed) {
                proc.stdin.write(response + "\n");
              }
              recentOutput = "";
            }).catch(() => {
              waitingForInput = false;
              recentOutput = "";
            });
          }
        }, 2000);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = timeout > 0 ? setTimeout(() => {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`OpenCode timed out after ${timeout}ms`));
      }, timeout) : null;

      proc.on("close", (code) => {
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

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }
}
