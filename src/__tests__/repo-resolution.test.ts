import { describe, it, expect } from "vitest";
import { resolveRepo } from "../git/git.js";

describe("git/git — resolveRepo", () => {
  it("should parse full GitHub URL to owner/repo", () => {
    const result = resolveRepo("https://github.com/SiluPanda/weav");
    expect(result).toBe("SiluPanda/weav");
  });

  it("should strip .git suffix from URL", () => {
    const result = resolveRepo("https://github.com/SiluPanda/weav.git");
    expect(result).toBe("SiluPanda/weav");
  });

  it("should return owner/repo as-is", () => {
    const result = resolveRepo("SiluPanda/weav");
    expect(result).toBe("SiluPanda/weav");
  });

  it("should resolve short name via gh api", () => {
    // This test requires gh auth — it calls the real gh CLI
    const result = resolveRepo("sweteam");
    expect(result).toContain("/sweteam");
    expect(result).toMatch(/^[^/]+\/sweteam$/);
  });
});
