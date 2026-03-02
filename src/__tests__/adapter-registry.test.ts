import { describe, it, expect } from "vitest";
import { resolveAdapter } from "../adapters/adapter.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import { OpenCodeAdapter } from "../adapters/opencode.js";
import { CustomAdapter } from "../adapters/custom.js";
import type { SweteamConfig } from "../config/loader.js";

const mockConfig: SweteamConfig = {
  roles: { planner: "claude-code", coder: "claude-code", reviewer: "codex" },
  execution: {
    max_parallel: 3,
    max_review_cycles: 3,
    branch_prefix: "sw/",
  },
  git: { commit_style: "conventional", squash_on_merge: true },
  agents: {
    "claude-code": { command: "claude", args: ["-p"] },
    codex: { command: "codex", args: ["-q"] },
    opencode: { command: "opencode", args: ["--non-interactive"] },
    "my-custom": {
      command: "my-tool",
      args: ["--auto"],
      prompt_via: "stdin",
      output_from: "stdout",
    },
  },
};

describe("adapters/adapter — resolveAdapter", () => {
  it("should resolve claude-code to ClaudeCodeAdapter", () => {
    const adapter = resolveAdapter("claude-code", mockConfig);
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.name).toBe("claude-code");
  });

  it("should resolve codex to CodexAdapter", () => {
    const adapter = resolveAdapter("codex", mockConfig);
    expect(adapter).toBeInstanceOf(CodexAdapter);
    expect(adapter.name).toBe("codex");
  });

  it("should resolve opencode to OpenCodeAdapter", () => {
    const adapter = resolveAdapter("opencode", mockConfig);
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
    expect(adapter.name).toBe("opencode");
  });

  it("should resolve custom agents from config", () => {
    const adapter = resolveAdapter("my-custom", mockConfig);
    expect(adapter).toBeInstanceOf(CustomAdapter);
    expect(adapter.name).toBe("my-custom");
  });

  it("should throw for unknown agent names", () => {
    expect(() => resolveAdapter("nonexistent", mockConfig)).toThrow(
      "Unknown agent: nonexistent",
    );
  });
});
