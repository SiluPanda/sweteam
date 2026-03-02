import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export function gh(args: string, cwd: string): string {
  return execSync(`gh ${args}`, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export function resolveRepo(input: string): string {
  // Full GitHub URL: https://github.com/owner/repo
  if (input.startsWith("https://")) {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      return match[1].replace(/\.git$/, "");
    }
    return input;
  }

  // Already fully qualified: owner/repo
  if (input.includes("/")) {
    return input;
  }

  // Short name: just repo name — resolve via gh api
  const user = gh("api user -q .login", ".");
  return `${user}/${input}`;
}

export function createBranch(
  name: string,
  base: string,
  cwd: string,
): void {
  try {
    git(`checkout -b ${name} ${base}`, cwd);
  } catch {
    // Branch already exists (e.g. retry after a failed build) — reset it to base
    git(`checkout ${name}`, cwd);
    git(`reset --hard ${base}`, cwd);
  }
}

export function squashMerge(
  source: string,
  target: string,
  message: string,
  cwd: string,
): void {
  git(`checkout ${target}`, cwd);
  git(`merge --squash ${source}`, cwd);
  git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
  git(`branch -D ${source}`, cwd);
}

export function getDiff(cwd: string): string {
  return git("diff", cwd);
}

export function getStagedDiff(cwd: string): string {
  return git("diff --cached", cwd);
}

export function commitAll(message: string, cwd: string): void {
  git("add -A", cwd);
  git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
}

export function pushBranch(branch: string, cwd: string): void {
  git(`push origin ${branch}`, cwd);
}

export function createPR(
  title: string,
  body: string,
  base: string,
  head: string,
  cwd: string,
): string {
  return gh(
    `pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${base} --head ${head}`,
    cwd,
  );
}

/** Check whether `dir` is inside a git working tree. */
export function isGitRepo(dir: string): boolean {
  try {
    git("rev-parse --is-inside-work-tree", dir);
    return true;
  } catch {
    return false;
  }
}

/** Return the git working-tree root for `dir`. */
export function getRepoRoot(dir: string): string {
  return git("rev-parse --show-toplevel", dir);
}

/** Derive an owner/repo slug from the origin remote URL. */
export function repoFromRemote(dir: string): string | null {
  try {
    const url = git("remote get-url origin", dir);
    // SSH:  git@github.com:owner/repo.git
    const ssh = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (ssh) return ssh[1];
    // HTTPS: https://github.com/owner/repo.git
    const https = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (https) return https[1];
    return null;
  } catch {
    return null;
  }
}

export function cloneOrLocateRepo(repo: string): string {
  const reposDir = join(homedir(), ".sweteam", "repos");
  const repoDirName = repo.replace("/", "--");
  const repoPath = join(reposDir, repoDirName);

  if (existsSync(repoPath)) {
    git("fetch origin", repoPath);
    git("checkout main", repoPath);
    git("pull", repoPath);
    return repoPath;
  }

  mkdirSync(reposDir, { recursive: true });
  gh(`repo clone ${repo} ${repoPath}`, ".");
  return repoPath;
}
