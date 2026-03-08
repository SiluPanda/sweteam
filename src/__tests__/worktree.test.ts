import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, realpathSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { git, addWorktree, removeWorktree, listWorktrees, cleanupWorktrees } from '../git/git.js';

function initRepo(): string {
  // Use realpathSync to resolve symlinks (e.g. /var -> /private/var on macOS)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sweteam-wt-test-')));
  execFileSync('git', ['init', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  // Create an initial commit so branches can be created
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('git worktree operations', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initRepo();
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try {
      cleanupWorktrees(join(realpathSync(tmpdir()), 'sweteam-wt-test-'), repoDir);
    } catch {
      /* ignore */
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe('addWorktree', () => {
    it('should create a worktree with a new branch', () => {
      const wtPath = join(repoDir, '.worktrees', 'task-1');
      addWorktree(wtPath, 'task-branch-1', 'main', repoDir);

      expect(existsSync(wtPath)).toBe(true);
      // Verify the branch exists
      const branches = git(['branch', '--list', 'task-branch-1'], repoDir);
      expect(branches).toContain('task-branch-1');
      // Verify the worktree is on the correct branch
      const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath);
      expect(currentBranch).toBe('task-branch-1');

      // Cleanup
      removeWorktree(wtPath, repoDir);
      try {
        git(['branch', '-D', 'task-branch-1'], repoDir);
      } catch {
        /* ignore */
      }
    });

    it('should create multiple independent worktrees', () => {
      const wt1 = join(repoDir, '.worktrees', 'task-1');
      const wt2 = join(repoDir, '.worktrees', 'task-2');

      addWorktree(wt1, 'branch-1', 'main', repoDir);
      addWorktree(wt2, 'branch-2', 'main', repoDir);

      expect(existsSync(wt1)).toBe(true);
      expect(existsSync(wt2)).toBe(true);

      // Changes in one worktree should not affect the other
      execFileSync('git', ['-C', wt1, 'commit', '--allow-empty', '-m', 'wt1 commit']);
      const log1 = git(['log', '--oneline'], wt1);
      const log2 = git(['log', '--oneline'], wt2);
      expect(log1).toContain('wt1 commit');
      expect(log2).not.toContain('wt1 commit');

      // Cleanup
      removeWorktree(wt1, repoDir);
      removeWorktree(wt2, repoDir);
      try {
        git(['branch', '-D', 'branch-1'], repoDir);
      } catch {
        /* ignore */
      }
      try {
        git(['branch', '-D', 'branch-2'], repoDir);
      } catch {
        /* ignore */
      }
    });

    it('should handle stale worktree at same path', () => {
      const wtPath = join(repoDir, '.worktrees', 'task-1');

      // Create first worktree
      addWorktree(wtPath, 'branch-1', 'main', repoDir);
      // Creating again at same path should clean up and recreate
      addWorktree(wtPath, 'branch-2', 'main', repoDir);

      const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath);
      expect(currentBranch).toBe('branch-2');

      // Cleanup
      removeWorktree(wtPath, repoDir);
      try {
        git(['branch', '-D', 'branch-2'], repoDir);
      } catch {
        /* ignore */
      }
    });

    it('should base worktree on the correct branch', () => {
      // Create a branch with a commit
      git(['checkout', '-b', 'feature', 'main'], repoDir);
      execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'feature commit']);
      git(['checkout', 'main'], repoDir);

      const wtPath = join(repoDir, '.worktrees', 'task-from-feature');
      addWorktree(wtPath, 'task-branch', 'feature', repoDir);

      // Worktree should have the feature commit
      const log = git(['log', '--oneline'], wtPath);
      expect(log).toContain('feature commit');

      // Cleanup
      removeWorktree(wtPath, repoDir);
      try {
        git(['branch', '-D', 'task-branch'], repoDir);
      } catch {
        /* ignore */
      }
      try {
        git(['branch', '-D', 'feature'], repoDir);
      } catch {
        /* ignore */
      }
    });
  });

  describe('removeWorktree', () => {
    it('should remove an existing worktree', () => {
      const wtPath = join(repoDir, '.worktrees', 'task-1');
      addWorktree(wtPath, 'branch-1', 'main', repoDir);
      expect(existsSync(wtPath)).toBe(true);

      removeWorktree(wtPath, repoDir);
      expect(existsSync(wtPath)).toBe(false);

      // Cleanup branch
      try {
        git(['branch', '-D', 'branch-1'], repoDir);
      } catch {
        /* ignore */
      }
    });

    it('should not throw when removing non-existent worktree', () => {
      expect(() => removeWorktree('/nonexistent/path', repoDir)).not.toThrow();
    });
  });

  describe('listWorktrees', () => {
    it('should list the main worktree', () => {
      const worktrees = listWorktrees(repoDir);
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      expect(worktrees[0].path).toBe(repoDir);
    });

    it('should list added worktrees', () => {
      const wt1 = join(repoDir, '.worktrees', 'task-1');
      const wt2 = join(repoDir, '.worktrees', 'task-2');

      addWorktree(wt1, 'branch-1', 'main', repoDir);
      addWorktree(wt2, 'branch-2', 'main', repoDir);

      const worktrees = listWorktrees(repoDir);
      expect(worktrees.length).toBe(3); // main + 2 worktrees

      const branches = worktrees.map((w) => w.branch);
      expect(branches).toContain('branch-1');
      expect(branches).toContain('branch-2');

      // Cleanup
      removeWorktree(wt1, repoDir);
      removeWorktree(wt2, repoDir);
      try {
        git(['branch', '-D', 'branch-1'], repoDir);
      } catch {
        /* ignore */
      }
      try {
        git(['branch', '-D', 'branch-2'], repoDir);
      } catch {
        /* ignore */
      }
    });

    it('should include commit hashes', () => {
      const worktrees = listWorktrees(repoDir);
      expect(worktrees[0].commit).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('cleanupWorktrees', () => {
    it('should remove worktrees matching a path prefix', () => {
      const baseDir = join(repoDir, '.worktrees');
      const wt1 = join(baseDir, 'session-a-task-1');
      const wt2 = join(baseDir, 'session-a-task-2');
      const wt3 = join(baseDir, 'session-b-task-1');

      addWorktree(wt1, 'branch-a1', 'main', repoDir);
      addWorktree(wt2, 'branch-a2', 'main', repoDir);
      addWorktree(wt3, 'branch-b1', 'main', repoDir);

      // Clean up only session-a worktrees
      cleanupWorktrees(join(baseDir, 'session-a'), repoDir);

      expect(existsSync(wt1)).toBe(false);
      expect(existsSync(wt2)).toBe(false);
      expect(existsSync(wt3)).toBe(true); // should not be removed

      // Cleanup remaining
      removeWorktree(wt3, repoDir);
      try {
        git(['branch', '-D', 'branch-b1'], repoDir);
      } catch {
        /* ignore */
      }
    });
  });

  describe('worktree isolation', () => {
    it('should allow concurrent file modifications in different worktrees', () => {
      const wt1 = join(repoDir, '.worktrees', 'task-1');
      const wt2 = join(repoDir, '.worktrees', 'task-2');

      addWorktree(wt1, 'branch-1', 'main', repoDir);
      addWorktree(wt2, 'branch-2', 'main', repoDir);

      // Write different content to the same filename in each worktree
      writeFileSync(join(wt1, 'file.txt'), 'content from task 1');
      writeFileSync(join(wt2, 'file.txt'), 'content from task 2');

      // Commit in each worktree independently
      git(['add', '-A'], wt1);
      git(['commit', '-m', 'task 1 changes'], wt1);
      git(['add', '-A'], wt2);
      git(['commit', '-m', 'task 2 changes'], wt2);

      // Verify each branch has its own content
      const diff1 = git(['diff', 'main...branch-1', '--', 'file.txt'], repoDir);
      const diff2 = git(['diff', 'main...branch-2', '--', 'file.txt'], repoDir);
      expect(diff1).toContain('content from task 1');
      expect(diff2).toContain('content from task 2');

      // Branches can be merged independently into main
      git(['checkout', 'main'], repoDir);
      git(['merge', '--squash', 'branch-1'], repoDir);
      git(['commit', '-m', 'merge task 1'], repoDir);

      // Main now has task 1's content
      const mainContent = readFileSync(join(repoDir, 'file.txt'), 'utf-8');
      expect(mainContent).toBe('content from task 1');

      // Cleanup
      removeWorktree(wt1, repoDir);
      removeWorktree(wt2, repoDir);
      try {
        git(['branch', '-D', 'branch-1'], repoDir);
      } catch {
        /* ignore */
      }
      try {
        git(['branch', '-D', 'branch-2'], repoDir);
      } catch {
        /* ignore */
      }
    });
  });
});
