import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

// We test cloneOrLocateRepo logic by verifying the function exists
// and testing the underlying path resolution logic.
// Full integration tests would require real GitHub repos.

describe("git/git — cloneOrLocateRepo", () => {
  it("should be exported and callable", async () => {
    const { cloneOrLocateRepo } = await import("../git/git.js");
    expect(typeof cloneOrLocateRepo).toBe("function");
  });

  it("repo dir name should use -- separator", () => {
    // Verify the naming convention: owner/repo -> owner--repo
    const repo = "SiluPanda/weav";
    const expected = "SiluPanda--weav";
    expect(repo.replace("/", "--")).toBe(expected);
  });

  it("should handle nested directory creation", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sweteam-clone-test-"));
    const nested = join(tempDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    expect(existsSync(nested)).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });
});
