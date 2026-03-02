import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { git, createBranch, squashMerge } from "../git/git.js";

describe("git/git — branch operations", () => {
  const tempDirs: string[] = [];

  function createTempGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-branch-test-"));
    tempDirs.push(dir);
    execSync("git init", { cwd: dir });
    execSync('git config user.email "test@test.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    // Create initial commit so we have a branch to work with
    writeFileSync(join(dir, "README.md"), "# Test\n");
    execSync("git add -A && git commit -m 'initial commit'", { cwd: dir });
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should create a new branch from a base", () => {
    const dir = createTempGitRepo();
    const baseBranch = git("branch --show-current", dir);

    createBranch("feature-branch", baseBranch, dir);

    const currentBranch = git("branch --show-current", dir);
    expect(currentBranch).toBe("feature-branch");
  });

  it("should squash merge a branch into target", () => {
    const dir = createTempGitRepo();
    const baseBranch = git("branch --show-current", dir);

    // Create feature branch and add a commit
    createBranch("feature-branch", baseBranch, dir);
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'add feature'", { cwd: dir });

    // Add another commit
    writeFileSync(join(dir, "feature2.ts"), "export const y = 2;\n");
    execSync("git add -A && git commit -m 'add feature2'", { cwd: dir });

    // Squash merge back
    squashMerge("feature-branch", baseBranch, "feat: merged feature", dir);

    // Should be on base branch
    const currentBranch = git("branch --show-current", dir);
    expect(currentBranch).toBe(baseBranch);

    // Feature branch should be deleted
    const branches = git("branch", dir);
    expect(branches).not.toContain("feature-branch");

    // The squash merge should be a single commit
    const log = git("log --oneline", dir);
    expect(log).toContain("feat: merged feature");
  });

  it("should handle commit messages with special characters", () => {
    const dir = createTempGitRepo();
    const baseBranch = git("branch --show-current", dir);

    createBranch("test-branch", baseBranch, dir);
    writeFileSync(join(dir, "test.ts"), "const t = 1;\n");
    execSync("git add -A && git commit -m 'add test'", { cwd: dir });

    squashMerge(
      "test-branch",
      baseBranch,
      "feat(task-001): add feature",
      dir,
    );

    const log = git("log --oneline -1", dir);
    expect(log).toContain("feat(task-001): add feature");
  });
});
