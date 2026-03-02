import { spawn, execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentAdapter, AgentResult } from "./adapter.js";
import type { AgentConfig } from "../config/loader.js";

export class CustomAdapter implements AgentAdapter {
  name: string;
  private config: AgentConfig;

  constructor(name: string, config: AgentConfig) {
    this.name = name;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync(`which ${this.config.command}`, {
        encoding: "utf-8",
        stdio: "pipe",
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
    onOutput?: (chunk: string) => void;
  }): Promise<AgentResult> {
    const timeout = opts.timeout ?? 0;
    const startTime = Date.now();
    const promptVia = this.config.prompt_via ?? "stdin";
    const outputFrom = this.config.output_from ?? "stdout";

    return new Promise((resolve, reject) => {
      const args = [...(this.config.args ?? [])];
      let promptFile: string | undefined;

      if (promptVia === "arg") {
        args.push(opts.prompt);
      } else if (promptVia === "file") {
        promptFile = join(tmpdir(), `sweteam-prompt-${Date.now()}.txt`);
        writeFileSync(promptFile, opts.prompt);
        args.push(promptFile);
      }

      const proc = spawn(this.config.command, args, {
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

      const timer = timeout > 0 ? setTimeout(() => {
        proc.kill("SIGTERM");
        cleanup();
        reject(new Error(`${this.name} timed out after ${timeout}ms`));
      }, timeout) : null;

      const cleanup = () => {
        if (promptFile) {
          try {
            unlinkSync(promptFile);
          } catch {}
        }
      };

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        let output = stdout || stderr;

        if (outputFrom === "file") {
          const outputFile = join(opts.cwd, ".sweteam-output.txt");
          try {
            output = readFileSync(outputFile, "utf-8");
            unlinkSync(outputFile);
          } catch {}
        }

        cleanup();
        resolve({
          output,
          exitCode: code ?? 1,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        cleanup();
        reject(err);
      });

      if (promptVia === "stdin") {
        proc.stdin.write(opts.prompt);
        proc.stdin.end();
      }
    });
  }
}
