import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  git,
  gh,
  createBranch,
  squashMerge,
  commitAll,
  getDiff,
  isGitRepo,
  getRepoRoot,
  getDefaultBranch,
  deleteBranches,
} from "../git/git.js";

describe("integration — git operations with array args", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sweteam-integ-"));
    execSync("git init", { cwd: dir });
    execSync('git config user.email "test@test.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    writeFileSync(join(dir, "README.md"), "# Test");
    execSync("git add -A && git commit -m 'initial commit'", { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("git() should accept array args and return output", () => {
    const status = git(["status", "--porcelain"], dir);
    expect(status).toBe("");
  });

  it("git() should handle single-element arrays", () => {
    const result = git(["status"], dir);
    expect(result).toContain("nothing to commit");
  });

  it("git() should handle multi-element arrays correctly", () => {
    const log = git(["log", "--oneline", "-1"], dir);
    expect(log).toContain("initial commit");
  });

  it("git() should throw on invalid commands", () => {
    expect(() => git(["nonexistent-command"], dir)).toThrow();
  });

  it("commitAll should handle messages with shell metacharacters safely", () => {
    writeFileSync(join(dir, "file.txt"), "content");
    // These characters would cause shell injection with execSync
    commitAll('feat: add `dangerous` $HOME $(whoami) "quotes"', dir);
    const log = git(["log", "--oneline", "-1"], dir);
    expect(log).toContain("dangerous");
  });

  it("commitAll should handle backticks in commit messages", () => {
    writeFileSync(join(dir, "file2.txt"), "content");
    commitAll("fix: handle `template literals` properly", dir);
    const log = git(["log", "-1", "--format=%s"], dir);
    expect(log).toContain("`template literals`");
  });

  it("squashMerge should handle messages with special characters", () => {
    // Create a feature branch with changes
    createBranch("feature", "HEAD", dir);
    writeFileSync(join(dir, "feature.txt"), "feature work");
    commitAll("feat: add feature", dir);

    const mainBranch = git(["branch", "--show-current"], dir).trim() === "feature"
      ? "main" : git(["branch", "--show-current"], dir);

    // Squash merge with special characters in message
    squashMerge("feature", "main", 'merge: $(whoami) `rm -rf /` "test"', dir);
    const log = git(["log", "-1", "--format=%s"], dir);
    expect(log).toContain("$(whoami)");
  });

  it("createBranch should create and switch to new branch", () => {
    createBranch("test-branch", "HEAD", dir);
    const current = git(["branch", "--show-current"], dir);
    expect(current).toBe("test-branch");
  });

  it("createBranch should handle existing branch by resetting", () => {
    createBranch("existing", "HEAD", dir);
    writeFileSync(join(dir, "extra.txt"), "extra");
    commitAll("extra commit", dir);

    // Go back to main
    git(["checkout", "main"], dir);
    // Re-create should not throw
    createBranch("existing", "HEAD", dir);
    const current = git(["branch", "--show-current"], dir);
    expect(current).toBe("existing");
  });

  it("isGitRepo should detect git repos", () => {
    expect(isGitRepo(dir)).toBe(true);
    const nonGit = mkdtempSync(join(tmpdir(), "non-git-"));
    expect(isGitRepo(nonGit)).toBe(false);
    rmSync(nonGit, { recursive: true, force: true });
  });

  it("getRepoRoot should return the repo root", () => {
    const root = getRepoRoot(dir);
    // On macOS, /var is symlinked to /private/var
    const normalize = (p: string) => p.replace(/^\/private/, "");
    expect(normalize(root)).toBe(normalize(dir));
  });

  it("getDiff should return empty string when no changes", () => {
    expect(getDiff(dir)).toBe("");
  });

  it("getDiff should return diff when files are modified", () => {
    writeFileSync(join(dir, "README.md"), "# Modified");
    const diff = getDiff(dir);
    expect(diff).toContain("Modified");
  });

  it("getDefaultBranch should detect the default branch", () => {
    const branch = getDefaultBranch(dir);
    // Our test repo uses "main" (modern git default)
    expect(["main", "master"]).toContain(branch);
  });

  it("deleteBranches should remove matching branches", () => {
    createBranch("sw/test-1", "HEAD", dir);
    git(["checkout", "main"], dir);
    createBranch("sw/test-2", "HEAD", dir);
    git(["checkout", "main"], dir);

    deleteBranches("sw/*", dir);
    const branches = git(["branch"], dir);
    expect(branches).not.toContain("sw/test-1");
    expect(branches).not.toContain("sw/test-2");
  });

  it("deleteBranches should handle no matching branches gracefully", () => {
    // Should not throw
    deleteBranches("nonexistent-*", dir);
  });
});
