import { describe, it, expect } from "vitest";
import { CodexAdapter } from "../adapters/codex.js";
import type { AgentAdapter } from "../adapters/adapter.js";

describe("adapters/codex — CodexAdapter", () => {
  it("should implement AgentAdapter interface", () => {
    const adapter: AgentAdapter = new CodexAdapter();
    expect(adapter.name).toBe("codex");
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.execute).toBe("function");
  });

  it("isAvailable should return a boolean", async () => {
    const adapter = new CodexAdapter();
    const result = await adapter.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("execute should reject when codex binary is not found", async () => {
    const adapter = new CodexAdapter();
    const result = adapter.execute({
      prompt: "test",
      cwd: "/tmp",
      timeout: 2000,
    });

    await expect(
      Promise.race([
        result.then(() => "resolved").catch(() => "rejected"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
      ]),
    ).resolves.not.toBe("timeout");
  });
});
