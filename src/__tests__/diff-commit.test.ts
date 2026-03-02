import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { getDiff, getStagedDiff, commitAll, git } from "../git/git.js";

describe("git/git — diff and commit functions", () => {
  const tempDirs: string[] = [];

  function createTempGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-diff-test-"));
    tempDirs.push(dir);
    execSync("git init", { cwd: dir });
    execSync('git config user.email "test@test.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
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

  it("getDiff should return empty string when no changes", () => {
    const dir = createTempGitRepo();
    const diff = getDiff(dir);
    expect(diff).toBe("");
  });

  it("getDiff should return unstaged changes", () => {
    const dir = createTempGitRepo();
    writeFileSync(join(dir, "README.md"), "# Updated\n");
    const diff = getDiff(dir);
    expect(diff).toContain("# Updated");
    expect(diff).toContain("diff --git");
  });

  it("getStagedDiff should return empty string when nothing staged", () => {
    const dir = createTempGitRepo();
    const diff = getStagedDiff(dir);
    expect(diff).toBe("");
  });

  it("getStagedDiff should return staged changes", () => {
    const dir = createTempGitRepo();
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync("git add new-file.ts", { cwd: dir });
    const diff = getStagedDiff(dir);
    expect(diff).toContain("new-file.ts");
    expect(diff).toContain("export const x = 1;");
  });

  it("getStagedDiff should not include unstaged changes", () => {
    const dir = createTempGitRepo();
    writeFileSync(join(dir, "staged.ts"), "export const a = 1;\n");
    execSync("git add staged.ts", { cwd: dir });
    writeFileSync(join(dir, "unstaged.ts"), "export const b = 2;\n");
    const diff = getStagedDiff(dir);
    expect(diff).toContain("staged.ts");
    expect(diff).not.toContain("unstaged.ts");
  });

  it("commitAll should stage and commit all changes", () => {
    const dir = createTempGitRepo();
    writeFileSync(join(dir, "file1.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "file2.ts"), "export const y = 2;\n");

    commitAll("feat: add two files", dir);

    const log = git("log --oneline -1", dir);
    expect(log).toContain("feat: add two files");

    // Working tree should be clean
    const status = git("status --porcelain", dir);
    expect(status).toBe("");
  });

  it("commitAll should handle messages with special characters", () => {
    const dir = createTempGitRepo();
    writeFileSync(join(dir, "test.ts"), "const t = 1;\n");

    commitAll('feat(task-001): add "quoted" feature', dir);

    const log = git("log --oneline -1", dir);
    expect(log).toContain("feat(task-001)");
  });
});
