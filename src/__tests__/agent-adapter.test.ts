import { describe, it, expect } from "vitest";
import type { AgentAdapter, AgentResult } from "../adapters/adapter.js";

describe("adapters/adapter — interface", () => {
  it("AgentResult should accept valid result objects", () => {
    const result: AgentResult = {
      output: "some output",
      exitCode: 0,
      durationMs: 1234,
    };
    expect(result.output).toBe("some output");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(1234);
  });

  it("AgentAdapter interface should be implementable", () => {
    const adapter: AgentAdapter = {
      name: "test-adapter",
      async isAvailable() {
        return true;
      },
      async execute(opts) {
        return {
          output: `executed in ${opts.cwd}`,
          exitCode: 0,
          durationMs: 100,
        };
      },
    };

    expect(adapter.name).toBe("test-adapter");
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.execute).toBe("function");
  });

  it("execute should support optional timeout and onOutput", async () => {
    const chunks: string[] = [];
    const adapter: AgentAdapter = {
      name: "test",
      async isAvailable() {
        return true;
      },
      async execute(opts) {
        if (opts.onOutput) {
          opts.onOutput("chunk1");
          opts.onOutput("chunk2");
        }
        return {
          output: "done",
          exitCode: 0,
          durationMs: opts.timeout ?? 0,
        };
      },
    };

    const result = await adapter.execute({
      prompt: "test",
      cwd: "/tmp",
      timeout: 5000,
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.output).toBe("done");
    expect(result.durationMs).toBe(5000);
    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });
});
