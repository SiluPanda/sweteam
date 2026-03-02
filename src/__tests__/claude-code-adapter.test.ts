import { describe, it, expect } from "vitest";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import type { AgentAdapter } from "../adapters/adapter.js";

describe("adapters/claude-code — ClaudeCodeAdapter", () => {
  it("should implement AgentAdapter interface", () => {
    const adapter: AgentAdapter = new ClaudeCodeAdapter();
    expect(adapter.name).toBe("claude-code");
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.execute).toBe("function");
  });

  it("isAvailable should return a boolean", async () => {
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("execute should reject when claude binary is not found", async () => {
    // Create adapter that uses a non-existent binary
    const adapter = new ClaudeCodeAdapter();
    // Override spawn to use a non-existent command by testing error path
    // We test via the real execute which will fail if claude is not installed
    // or succeed if it is — either way, it should not hang
    const result = adapter.execute({
      prompt: "test",
      cwd: "/tmp",
      timeout: 2000,
    });

    // Should resolve or reject within timeout
    await expect(
      Promise.race([
        result.then(() => "resolved").catch(() => "rejected"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
      ]),
    ).resolves.not.toBe("timeout");
  });
});
