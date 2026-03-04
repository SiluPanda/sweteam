import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, setConfigOverrides } from "../config/loader.js";

describe("integration — config overrides", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweteam-config-"));
    // Reset overrides before each test
    setConfigOverrides({});
  });

  afterEach(() => {
    setConfigOverrides({});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should use default config when no file exists", () => {
    const config = loadConfig(join(tmpDir, "nonexistent.toml"));
    expect(config.roles.coder).toBe("claude-code");
    expect(config.roles.reviewer).toBe("claude-code");
    expect(config.execution.max_parallel).toBe(3);
  });

  it("should load config from TOML file", () => {
    const configPath = join(tmpDir, "config.toml");
    writeFileSync(
      configPath,
      `
[roles]
coder = "codex"
reviewer = "codex"

[execution]
max_parallel = 5
`,
    );
    const config = loadConfig(configPath);
    expect(config.roles.coder).toBe("codex");
    expect(config.roles.reviewer).toBe("codex");
    expect(config.execution.max_parallel).toBe(5);
    // Planner should still be default
    expect(config.roles.planner).toBe("claude-code");
  });

  it("should apply CLI overrides over file config", () => {
    const configPath = join(tmpDir, "config.toml");
    writeFileSync(
      configPath,
      `
[roles]
coder = "codex"
reviewer = "codex"
`,
    );

    setConfigOverrides({
      coder: "opencode",
      parallel: 10,
    });

    const config = loadConfig(configPath);
    expect(config.roles.coder).toBe("opencode");
    expect(config.roles.reviewer).toBe("codex"); // Not overridden
    expect(config.execution.max_parallel).toBe(10);
  });

  it("should apply CLI overrides over defaults", () => {
    setConfigOverrides({
      reviewer: "codex",
      parallel: 1,
    });

    const config = loadConfig(join(tmpDir, "nonexistent.toml"));
    expect(config.roles.reviewer).toBe("codex");
    expect(config.execution.max_parallel).toBe(1);
  });

  it("should not apply NaN parallel value", () => {
    setConfigOverrides({ parallel: NaN });
    const config = loadConfig(join(tmpDir, "nonexistent.toml"));
    // NaN > 0 is false, so default should be preserved
    expect(config.execution.max_parallel).toBe(3);
  });

  it("should not apply zero parallel value", () => {
    setConfigOverrides({ parallel: 0 });
    const config = loadConfig(join(tmpDir, "nonexistent.toml"));
    // 0 > 0 is false, so default should be preserved
    expect(config.execution.max_parallel).toBe(3);
  });
});
