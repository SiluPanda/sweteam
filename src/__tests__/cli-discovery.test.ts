import { describe, it, expect } from "vitest";
import { discoverClis, getDiscoveredAgents, type CliInfo } from "../config/discovery.js";

describe("config/discovery", () => {
  it("should return an array of CLI info objects", () => {
    const clis = discoverClis();
    expect(Array.isArray(clis)).toBe(true);
    expect(clis.length).toBeGreaterThanOrEqual(5);

    for (const cli of clis) {
      expect(cli).toHaveProperty("name");
      expect(cli).toHaveProperty("available");
      expect(typeof cli.name).toBe("string");
      expect(typeof cli.available).toBe("boolean");
    }
  });

  it("should detect git as available", () => {
    const clis = discoverClis();
    const git = clis.find((c) => c.name === "git");
    expect(git).toBeDefined();
    expect(git!.available).toBe(true);
    expect(git!.path).toBeDefined();
    expect(git!.version).toBeDefined();
  });

  it("should include all expected tool names", () => {
    const clis = discoverClis();
    const names = clis.map((c) => c.name);
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("opencode");
    expect(names).toContain("gh");
    expect(names).toContain("git");
  });

  it("should build agents config from discovered CLIs", () => {
    const mockClis: CliInfo[] = [
      { name: "claude", available: true, path: "/usr/bin/claude", version: "1.0" },
      { name: "codex", available: true, path: "/usr/bin/codex", version: "0.1" },
      { name: "opencode", available: false },
      { name: "gh", available: true, path: "/usr/bin/gh", version: "2.0" },
      { name: "git", available: true, path: "/usr/bin/git", version: "2.43" },
    ];

    const agents = getDiscoveredAgents(mockClis);
    expect(agents["claude-code"]).toEqual({ command: "claude", args: ["-p"] });
    expect(agents["codex"]).toEqual({ command: "codex", args: ["-q"] });
    expect(agents["opencode"]).toBeUndefined();
  });

  it("should return empty agents when no coding CLIs available", () => {
    const mockClis: CliInfo[] = [
      { name: "claude", available: false },
      { name: "codex", available: false },
      { name: "opencode", available: false },
      { name: "gh", available: true, path: "/usr/bin/gh", version: "2.0" },
      { name: "git", available: true, path: "/usr/bin/git", version: "2.43" },
    ];

    const agents = getDiscoveredAgents(mockClis);
    expect(Object.keys(agents)).toHaveLength(0);
  });
});
