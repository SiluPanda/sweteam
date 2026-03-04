import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { git, gh } from "../git/git.js";

describe("git/git — core wrappers", () => {
  const tempDirs: string[] = [];

  function createTempGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-git-test-"));
    tempDirs.push(dir);
    execSync("git init", { cwd: dir });
    execSync('git config user.email "test@test.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should execute git commands and return output", () => {
    const dir = createTempGitRepo();
    const status = git(["status"], dir);
    expect(status).toContain("On branch");
  });

  it("should return trimmed output", () => {
    const dir = createTempGitRepo();
    const result = git(["rev-parse", "--is-inside-work-tree"], dir);
    expect(result).toBe("true");
  });

  it("should throw on invalid git command", () => {
    const dir = createTempGitRepo();
    expect(() => git(["nonexistent-command"], dir)).toThrow();
  });

  it("should work with the specified cwd", () => {
    const dir = createTempGitRepo();
    const topLevel = git(["rev-parse", "--show-toplevel"], dir);
    // Should be the temp dir (possibly with resolved symlinks)
    expect(topLevel).toBeTruthy();
  });

  it("gh() should execute gh commands", () => {
    // Just verify gh is callable — don't test auth-dependent commands
    const result = gh(["--version"], ".");
    expect(result).toContain("gh version");
  });
});
