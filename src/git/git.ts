import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Run a git command with array-based arguments (no shell interpolation).
 * This prevents command injection via commit messages, branch names, etc.
 */
export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

/**
 * Run a gh CLI command with array-based arguments (no shell interpolation).
 */
export function gh(args: string[], cwd: string): string {
  return execFileSync("gh", args, {
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
  const user = gh(["api", "user", "-q", ".login"], ".");
  return `${user}/${input}`;
}

/** Detect the default branch name for the repo (main, master, etc.). */
export function getDefaultBranch(cwd: string): string {
  try {
    // Try to get the default branch from the remote HEAD
    const ref = git(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd);
    // Returns e.g. "origin/main" — strip the "origin/" prefix
    return ref.replace(/^origin\//, "");
  } catch {
    // Fallback: check if "main" exists, otherwise try "master"
    try {
      git(["rev-parse", "--verify", "main"], cwd);
      return "main";
    } catch {
      try {
        git(["rev-parse", "--verify", "master"], cwd);
        return "master";
      } catch {
        return "main";
      }
    }
  }
}

export function createBranch(
  name: string,
  base: string,
  cwd: string,
): void {
  try {
    git(["checkout", "-b", name, base], cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("cannot lock ref") || msg.includes("exists; cannot create")) {
      // Git ref conflict — e.g. branch "sw/X" blocks "sw/X/Y" or vice versa.
      // Delete the conflicting ref and retry.
      const match = msg.match(/'refs\/heads\/([^']+)' exists/);
      if (match) {
        try { git(["branch", "-D", match[1]], cwd); } catch { /* ignore */ }
      }
      git(["checkout", "-b", name, base], cwd);
    } else if (msg.includes("already exists")) {
      // Branch already exists — reset it to the base for a clean start
      git(["checkout", name], cwd);
      git(["reset", "--hard", base], cwd);
    } else {
      // Unexpected error — do not do destructive operations, re-throw
      throw err;
    }
  }
}

export function squashMerge(
  source: string,
  target: string,
  message: string,
  cwd: string,
): void {
  git(["checkout", target], cwd);
  try {
    git(["merge", "--squash", source], cwd);
    git(["commit", "-m", message], cwd);
  } catch (err) {
    // Clean up the failed merge to restore a clean working tree
    try { git(["merge", "--abort"], cwd); } catch { /* no merge in progress */ }
    try { git(["reset", "--hard", "HEAD"], cwd); } catch { /* best effort */ }
    throw err;
  }
  git(["branch", "-D", source], cwd);
}

export function getDiff(cwd: string): string {
  return git(["diff"], cwd);
}

export function getStagedDiff(cwd: string): string {
  return git(["diff", "--cached"], cwd);
}

export function commitAll(message: string, cwd: string): void {
  git(["add", "-A"], cwd);
  git(["commit", "-m", message], cwd);
}

export function pushBranch(branch: string, cwd: string): void {
  git(["push", "origin", branch], cwd);
}

export function createPR(
  title: string,
  body: string,
  base: string,
  head: string,
  cwd: string,
): string {
  return gh(
    ["pr", "create", "--title", title, "--body", body, "--base", base, "--head", head],
    cwd,
  );
}

/** Check whether `dir` is inside a git working tree. */
export function isGitRepo(dir: string): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"], dir);
    return true;
  } catch {
    return false;
  }
}

/** Return the git working-tree root for `dir`. */
export function getRepoRoot(dir: string): string {
  return git(["rev-parse", "--show-toplevel"], dir);
}

/** Derive an owner/repo slug from the origin remote URL. */
export function repoFromRemote(dir: string): string | null {
  try {
    const url = git(["remote", "get-url", "origin"], dir);
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

/** Delete branches matching a pattern (for cleanup). */
export function deleteBranches(pattern: string, cwd: string): void {
  try {
    const branches = git(["branch", "--list", pattern], cwd)
      .split("\n")
      .map(b => b.trim().replace(/^\* /, ""))
      .filter(Boolean);
    for (const branch of branches) {
      try {
        git(["branch", "-D", branch], cwd);
      } catch {
        // Ignore errors deleting individual branches
      }
    }
  } catch {
    // No branches to delete
  }
}

export function cloneOrLocateRepo(repo: string, defaultBranch?: string): string {
  const reposDir = join(homedir(), ".sweteam", "repos");
  const repoDirName = repo.replace("/", "--");
  const repoPath = join(reposDir, repoDirName);

  if (existsSync(repoPath)) {
    git(["fetch", "origin"], repoPath);
    const branch = defaultBranch ?? getDefaultBranch(repoPath);
    git(["checkout", branch], repoPath);
    git(["pull"], repoPath);
    return repoPath;
  }

  mkdirSync(reposDir, { recursive: true });
  gh(["repo", "clone", repo, repoPath], ".");
  return repoPath;
}
