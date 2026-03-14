import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Run a git command with array-based arguments (no shell interpolation).
 * This prevents command injection via commit messages, branch names, etc.
 */
export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

/**
 * Run a gh CLI command with array-based arguments (no shell interpolation).
 */
export function gh(args: string[], cwd: string): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

export function resolveRepo(input: string): string {
  let resolved: string;

  // Full GitHub URL: https://github.com/owner/repo
  if (input.startsWith('https://')) {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      resolved = match[1].replace(/\.git$/, '');
    } else {
      resolved = input;
    }
  } else if (input.includes('/')) {
    // Already fully qualified: owner/repo
    resolved = input;
  } else {
    // Short name: just repo name — resolve via gh api
    const user = gh(['api', 'user', '-q', '.login'], '.');
    resolved = `${user}/${input}`;
  }

  // Sanitize against path traversal
  const sanitized = resolved.replace(/\.\./g, '').replace(/[<>|]/g, '');
  if (!sanitized || sanitized === '/') throw new Error('Invalid repository name');
  return sanitized;
}

/** Detect the default branch name for the repo (main, master, etc.). */
export function getDefaultBranch(cwd: string): string {
  try {
    // Try to get the default branch from the remote HEAD
    const ref = git(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], cwd);
    // Returns e.g. "origin/main" — strip the "origin/" prefix
    return ref.replace(/^origin\//, '');
  } catch {
    // Fallback: check if "main" exists, otherwise try "master"
    try {
      git(['rev-parse', '--verify', 'main'], cwd);
      return 'main';
    } catch {
      try {
        git(['rev-parse', '--verify', 'master'], cwd);
        return 'master';
      } catch {
        return 'main';
      }
    }
  }
}

export function createBranch(name: string, base: string, cwd: string): string {
  try {
    git(['checkout', '-b', name, base], cwd);
    return name;
  } catch {
    // Branch creation failed — avoid locale-dependent error message parsing.
    // First, try checking out and resetting the existing branch (common case).
    try {
      git(['checkout', name], cwd);
      git(['reset', '--hard', base], cwd);
      return name;
    } catch {
      // Branch doesn't exist either (ref conflict, etc.) — try deleting
      // conflicting sweteam-managed refs, then retry with a unique suffix.
      if (name.startsWith('sw/')) {
        // Clean up any conflicting sw/ refs that block this path
        try {
          const branches = git(['branch', '--list', 'sw/*'], cwd)
            .split('\n')
            .map((b) => b.trim().replace(/^\* /, ''))
            .filter(Boolean);
          for (const branch of branches) {
            // Delete refs that conflict with the target name hierarchy
            if (name.startsWith(branch + '/') || branch.startsWith(name + '/')) {
              try {
                git(['branch', '-D', branch], cwd);
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          /* ignore */
        }

        // Retry after cleanup
        try {
          git(['checkout', '-b', name, base], cwd);
          return name;
        } catch {
          /* fall through to unique name */
        }
      }

      const uniqueName = `${name}-${Date.now()}`;
      git(['checkout', '-b', uniqueName, base], cwd);
      return uniqueName;
    }
  }
}

export function squashMerge(source: string, target: string, message: string, cwd: string): void {
  git(['checkout', target], cwd);
  try {
    git(['merge', '--squash', source], cwd);
    git(['commit', '-m', message], cwd);
  } catch (err) {
    // Clean up the failed merge to restore a clean working tree
    try {
      git(['merge', '--abort'], cwd);
    } catch {
      /* no merge in progress */
    }
    try {
      git(['reset', '--hard', 'HEAD'], cwd);
    } catch {
      /* best effort */
    }
    throw err;
  }
  // Best-effort branch cleanup — may fail if checked out in a worktree
  // (parallel runner cleans up worktrees and branches in its finally block)
  try {
    git(['branch', '-D', source], cwd);
  } catch {
    /* ignore */
  }
}

export function getDiff(cwd: string): string {
  return git(['diff'], cwd);
}

export function getStagedDiff(cwd: string): string {
  return git(['diff', '--cached'], cwd);
}

export function commitAll(message: string, cwd: string): void {
  git(['add', '-A'], cwd);
  git(['commit', '-m', message], cwd);
}

export function pushBranch(branch: string, cwd: string): void {
  git(['push', 'origin', branch], cwd);
}

export function createPR(
  title: string,
  body: string,
  base: string,
  head: string,
  cwd: string,
): string {
  return gh(
    ['pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head],
    cwd,
  );
}

/** Check whether `dir` is inside a git working tree. */
export function isGitRepo(dir: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], dir);
    return true;
  } catch {
    return false;
  }
}

/** Return the git working-tree root for `dir`. */
export function getRepoRoot(dir: string): string {
  return git(['rev-parse', '--show-toplevel'], dir);
}

/** Derive an owner/repo slug from the origin remote URL. */
export function repoFromRemote(dir: string): string | null {
  try {
    const url = git(['remote', 'get-url', 'origin'], dir);
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
    const branches = git(['branch', '--list', pattern], cwd)
      .split('\n')
      .map((b) => b.trim().replace(/^\* /, ''))
      .filter(Boolean);
    for (const branch of branches) {
      try {
        git(['branch', '-D', branch], cwd);
      } catch {
        // Ignore errors deleting individual branches
      }
    }
  } catch {
    // No branches to delete
  }
}

export function cloneOrLocateRepo(repo: string, defaultBranch?: string): string {
  const reposDir = join(homedir(), '.sweteam', 'repos');
  const repoDirName = repo.replace('/', '--');
  const repoPath = join(reposDir, repoDirName);

  if (existsSync(repoPath)) {
    // Verify the directory is a valid git repo before operating on it
    try {
      git(['rev-parse', '--is-inside-work-tree'], repoPath);
    } catch {
      // Corrupted repo — remove and re-clone
      rmSync(repoPath, { recursive: true, force: true });
      mkdirSync(reposDir, { recursive: true });
      gh(['repo', 'clone', repo, repoPath], '.');
      return repoPath;
    }

    git(['fetch', 'origin'], repoPath);
    const branch = defaultBranch ?? getDefaultBranch(repoPath);
    git(['checkout', branch], repoPath);
    git(['pull'], repoPath);
    return repoPath;
  }

  mkdirSync(reposDir, { recursive: true });
  gh(['repo', 'clone', repo, repoPath], '.');
  return repoPath;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
}

/** Create a git worktree with a new branch based on the given base branch. */
export function addWorktree(
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  cwd: string,
): void {
  // Clean up stale worktree at this path if it exists
  try {
    git(['worktree', 'remove', '--force', worktreePath], cwd);
  } catch {
    /* doesn't exist */
  }
  // Delete stale branch if it exists (from a previous failed run)
  try {
    git(['branch', '-D', branchName], cwd);
  } catch {
    /* doesn't exist */
  }

  mkdirSync(worktreePath, { recursive: true });
  // Remove the directory so git worktree add can create it fresh
  rmSync(worktreePath, { recursive: true, force: true });

  git(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], cwd);
}

/** Remove a git worktree and prune stale entries. */
export function removeWorktree(worktreePath: string, cwd: string): void {
  try {
    git(['worktree', 'remove', '--force', worktreePath], cwd);
  } catch {
    // Worktree may already be removed
  }
  try {
    git(['worktree', 'prune'], cwd);
  } catch {
    // Best effort
  }
}

/** List all worktrees for a repository. */
export function listWorktrees(cwd: string): WorktreeInfo[] {
  const output = git(['worktree', 'list', '--porcelain'], cwd);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.commit = line.slice('HEAD '.length);
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === '') {
      if (current.path && current.commit) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? '(detached)',
          commit: current.commit,
        });
      }
      current = {};
    }
  }
  // Handle last entry (may not have trailing newline)
  if (current.path && current.commit) {
    worktrees.push({
      path: current.path,
      branch: current.branch ?? '(detached)',
      commit: current.commit,
    });
  }

  return worktrees;
}

/** Remove all worktrees whose paths start with a given prefix. */
export function cleanupWorktrees(pathPrefix: string, cwd: string): void {
  const worktrees = listWorktrees(cwd);
  for (const wt of worktrees) {
    if (wt.path.startsWith(pathPrefix)) {
      removeWorktree(wt.path, cwd);
    }
  }
}
