import { spawn, execSync } from "child_process";
import type { AgentAdapter, AgentResult } from "./adapter.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  name = "claude-code";

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which claude", { encoding: "utf-8", stdio: "pipe" });
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
  }): Promise<AgentResult> {
    const timeout = opts.timeout ?? 300000; // 5 min default
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const proc = spawn("claude", ["-p", "--output-format", "json"], {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (opts.onOutput) {
          opts.onOutput(text);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Claude Code timed out after ${timeout}ms`));
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          output: stdout || stderr,
          exitCode: code ?? 1,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.stdin.write(opts.prompt);
      proc.stdin.end();
    });
  }
}
