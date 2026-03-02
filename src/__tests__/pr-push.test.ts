import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { git, pushBranch, createPR } from "../git/git.js";

describe("git/git — PR and push functions", () => {
  const tempDirs: string[] = [];

  function createTempGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-pr-test-"));
    tempDirs.push(dir);
    execSync("git init --bare", { cwd: dir });
    return dir;
  }

  function createTempGitRepoWithRemote(): {
    workDir: string;
    bareDir: string;
  } {
    // Create a bare repo to act as "remote"
    const bareDir = mkdtempSync(join(tmpdir(), "sweteam-pr-bare-"));
    tempDirs.push(bareDir);
    execSync("git init --bare", { cwd: bareDir });

    // Create a working copy with bare as remote
    const workDir = mkdtempSync(join(tmpdir(), "sweteam-pr-work-"));
    tempDirs.push(workDir);
    execSync("git init", { cwd: workDir });
    execSync('git config user.email "test@test.com"', { cwd: workDir });
    execSync('git config user.name "Test"', { cwd: workDir });
    execSync(`git remote add origin ${bareDir}`, { cwd: workDir });

    // Create initial commit and push
    writeFileSync(join(workDir, "README.md"), "# Test\n");
    execSync("git add -A && git commit -m 'initial commit'", {
      cwd: workDir,
    });
    const branch = execSync("git branch --show-current", {
      cwd: workDir,
      encoding: "utf-8",
    }).trim();
    execSync(`git push -u origin ${branch}`, { cwd: workDir });

    return { workDir, bareDir };
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("pushBranch should push a branch to the remote", () => {
    const { workDir, bareDir } = createTempGitRepoWithRemote();

    // Create a new branch with a commit
    execSync("git checkout -b feature-branch", { cwd: workDir });
    writeFileSync(join(workDir, "feature.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'add feature'", { cwd: workDir });

    // Push the branch
    pushBranch("feature-branch", workDir);

    // Verify branch exists on the bare remote
    const remoteBranches = execSync("git branch", {
      cwd: bareDir,
      encoding: "utf-8",
    });
    expect(remoteBranches).toContain("feature-branch");
  });

  it("createPR function should be callable", () => {
    // We can't test actual PR creation without a real GitHub repo,
    // but we can verify the function exists and has the right signature
    expect(typeof createPR).toBe("function");
    expect(createPR.length).toBe(5); // 5 parameters
  });
});
