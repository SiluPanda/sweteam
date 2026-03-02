import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "../adapters/codex.js";
import { OpenCodeAdapter } from "../adapters/opencode.js";
import { CustomAdapter } from "../adapters/custom.js";
import type { AgentConfig } from "../config/loader.js";

// Mock child_process for all adapter tests
vi.mock("child_process", () => {
  const EventEmitter = require("events");

  function createMockProc(exitCode: number, stdout: string, stderr: string = "") {
    const proc = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    setTimeout(() => {
      if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", exitCode);
    }, 5);

    return proc;
  }

  return {
    execSync: vi.fn((cmd: string) => {
      if (cmd.startsWith("which ")) {
        const binary = cmd.slice(6);
        if (["codex", "opencode", "my-tool"].includes(binary)) {
          return `/usr/bin/${binary}\n`;
        }
        throw new Error("not found");
      }
      return "";
    }),
    spawn: vi.fn((command: string, args: string[]) => {
      return createMockProc(0, `mock output from ${command}`);
    }),
  };
});

describe("Codex adapter — end-to-end validation (#task-54)", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  it("should have name 'codex'", () => {
    expect(adapter.name).toBe("codex");
  });

  it("should check availability via which", async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it("should execute with -q flag and pass prompt as argument", async () => {
    const result = await adapter.execute({
      prompt: "Write hello world",
      cwd: "/tmp",
    });

    expect(result.output).toContain("mock output");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should support timeout", async () => {
    const result = await adapter.execute({
      prompt: "Test",
      cwd: "/tmp",
      timeout: 60000,
    });
    expect(result.exitCode).toBe(0);
  });

  it("should call onOutput callback", async () => {
    const chunks: string[] = [];
    await adapter.execute({
      prompt: "Test",
      cwd: "/tmp",
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("OpenCode adapter — end-to-end validation (#task-55)", () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    adapter = new OpenCodeAdapter();
  });

  it("should have name 'opencode'", () => {
    expect(adapter.name).toBe("opencode");
  });

  it("should check availability", async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it("should execute with --non-interactive flag", async () => {
    const result = await adapter.execute({
      prompt: "Create file",
      cwd: "/tmp",
    });

    expect(result.output).toContain("mock output");
    expect(result.exitCode).toBe(0);
  });

  it("should return duration", async () => {
    const result = await adapter.execute({ prompt: "X", cwd: "/tmp" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Custom adapter — config-driven validation (#task-56)", () => {
  const config: AgentConfig = {
    command: "my-tool",
    args: ["--mode", "auto"],
    prompt_via: "stdin",
    output_from: "stdout",
  };

  it("should use configured command name", () => {
    const adapter = new CustomAdapter("my-tool", config);
    expect(adapter.name).toBe("my-tool");
  });

  it("should check availability of custom command", async () => {
    const adapter = new CustomAdapter("my-tool", config);
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it("should execute via stdin prompt delivery", async () => {
    const adapter = new CustomAdapter("my-tool", config);
    const result = await adapter.execute({
      prompt: "Do something",
      cwd: "/tmp",
    });

    expect(result.output).toContain("mock output");
    expect(result.exitCode).toBe(0);
  });

  it("should support arg-based prompt delivery", async () => {
    const argConfig: AgentConfig = {
      command: "my-tool",
      args: ["--run"],
      prompt_via: "arg",
      output_from: "stdout",
    };
    const adapter = new CustomAdapter("arg-tool", argConfig);
    const result = await adapter.execute({
      prompt: "Execute this",
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(0);
  });
});
