import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { buildDag, getReadyTasks, topologicalSort } from '../orchestrator/dag.js';
import type { TaskRecord } from '../orchestrator/task-runner.js';

function makeTask(id: string, deps: string[] = [], status: string = 'queued'): TaskRecord {
  return {
    id,
    sessionId: 's_test',
    title: `Task ${id}`,
    description: `Description for ${id}`,
    filesLikelyTouched: null,
    acceptanceCriteria: null,
    dependsOn: deps.length > 0 ? JSON.stringify(deps) : null,
    branchName: null,
    status,
  };
}

describe('parallel runner — DAG scheduling', () => {
  it('should return all tasks as ready when there are no dependencies', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    const dag = buildDag(tasks);

    const ready = getReadyTasks(dag, new Set(), new Set(), new Set(), new Set());
    expect(ready).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(ready.length).toBe(3);
  });

  it('should respect dependency ordering', () => {
    // a -> b -> c (c depends on b, b depends on a)
    const tasks = [makeTask('a'), makeTask('b', ['a']), makeTask('c', ['b'])];
    const dag = buildDag(tasks);

    // Initially only a is ready
    const completed = new Set<string>();
    let ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(['a']);

    // After a completes, b is ready
    completed.add('a');
    ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(['b']);

    // After b completes, c is ready
    completed.add('b');
    ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(['c']);
  });

  it('should return parallel tasks when dependencies allow', () => {
    // a -> b, a -> c (b and c both depend only on a)
    const tasks = [makeTask('a'), makeTask('b', ['a']), makeTask('c', ['a'])];
    const dag = buildDag(tasks);

    const completed = new Set(['a']);
    const ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(expect.arrayContaining(['b', 'c']));
    expect(ready.length).toBe(2);
  });

  it('should exclude running tasks from ready list', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    const dag = buildDag(tasks);

    const running = new Set(['a', 'b']);
    const ready = getReadyTasks(dag, new Set(), running, new Set(), new Set());
    expect(ready).toEqual(['c']);
  });

  it('should block tasks whose dependencies failed', () => {
    const tasks = [makeTask('a'), makeTask('b', ['a']), makeTask('c', ['a'])];
    const dag = buildDag(tasks);

    const failed = new Set(['a']);
    const blocked = new Set<string>();
    const ready = getReadyTasks(dag, new Set(), new Set(), failed, blocked);
    expect(ready).toEqual([]);
    // b and c should be blocked
    expect(blocked.has('b')).toBe(true);
    expect(blocked.has('c')).toBe(true);
  });

  it('should transitively block downstream tasks in a single pass', () => {
    // a -> b -> c -> d
    // When a fails, getReadyTasks iterates in insertion order (a, b, c, d).
    // b depends on failed a -> blocked. c depends on blocked b -> blocked.
    // d depends on blocked c -> blocked. All in one call.
    const tasks = [makeTask('a'), makeTask('b', ['a']), makeTask('c', ['b']), makeTask('d', ['c'])];
    const dag = buildDag(tasks);

    const failed = new Set(['a']);
    const blocked = new Set<string>();

    const ready = getReadyTasks(dag, new Set(), new Set(), failed, blocked);
    expect(ready).toEqual([]);
    expect(blocked.has('b')).toBe(true);
    expect(blocked.has('c')).toBe(true);
    expect(blocked.has('d')).toBe(true);
  });

  it('should handle diamond dependency pattern', () => {
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d
    const tasks = [
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b', 'c']),
    ];
    const dag = buildDag(tasks);

    // After a completes, b and c are ready (parallel)
    let completed = new Set(['a']);
    let ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(expect.arrayContaining(['b', 'c']));
    expect(ready.length).toBe(2);

    // After only b completes, d is NOT ready (still needs c)
    completed = new Set(['a', 'b']);
    ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(['c']); // only c is ready

    // After both b and c complete, d is ready
    completed = new Set(['a', 'b', 'c']);
    ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual(['d']);
  });

  it('should skip already completed/failed/blocked tasks', () => {
    const tasks = [
      makeTask('a', [], 'done'),
      makeTask('b', [], 'failed'),
      makeTask('c', [], 'blocked'),
      makeTask('d'),
    ];
    const dag = buildDag(tasks);

    const completed = new Set(['a']);
    const failed = new Set(['b']);
    const blocked = new Set(['c']);
    const ready = getReadyTasks(dag, completed, new Set(), failed, blocked);
    expect(ready).toEqual(['d']);
  });

  it('should block only the affected branch in a partial failure', () => {
    //     a       e
    //    / \      |
    //   b   c     f
    //   |
    //   d
    // If a fails, b/c/d are blocked but e/f are unaffected
    const tasks = [
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b']),
      makeTask('e'),
      makeTask('f', ['e']),
    ];
    const dag = buildDag(tasks);

    const failed = new Set(['a']);
    const completed = new Set(['e']);
    const blocked = new Set<string>();
    const ready = getReadyTasks(dag, completed, new Set(), failed, blocked);

    // b, c, d should be blocked
    expect(blocked.has('b')).toBe(true);
    expect(blocked.has('c')).toBe(true);
    expect(blocked.has('d')).toBe(true);

    // f should be ready (e completed, independent of a's failure)
    expect(ready).toEqual(['f']);
  });

  it('should handle tasks with dependencies on non-existent nodes', () => {
    // Task b depends on "missing" which is not in the DAG.
    // Since "missing" is never in completedIds, b should not be ready.
    const tasks = [makeTask('a'), makeTask('b', ['missing'])];
    const dag = buildDag(tasks);

    const ready = getReadyTasks(dag, new Set(), new Set(), new Set(), new Set());
    // a is ready, b is not (dep "missing" not completed)
    expect(ready).toEqual(['a']);
  });

  it('should handle single task with no dependencies', () => {
    const tasks = [makeTask('only')];
    const dag = buildDag(tasks);

    const ready = getReadyTasks(dag, new Set(), new Set(), new Set(), new Set());
    expect(ready).toEqual(['only']);
  });

  it('should return empty when all tasks are done', () => {
    const tasks = [makeTask('a'), makeTask('b')];
    const dag = buildDag(tasks);

    const completed = new Set(['a', 'b']);
    const ready = getReadyTasks(dag, completed, new Set(), new Set(), new Set());
    expect(ready).toEqual([]);
  });
});

describe('parallel runner — topological sort', () => {
  it('should detect circular dependencies', () => {
    // a -> b -> a (cycle)
    const tasks = [makeTask('a', ['b']), makeTask('b', ['a'])];
    const dag = buildDag(tasks);
    expect(() => topologicalSort(dag)).toThrow('Circular dependency');
  });

  it('should detect self-referencing dependency', () => {
    const tasks = [makeTask('a', ['a'])];
    const dag = buildDag(tasks);
    expect(() => topologicalSort(dag)).toThrow('Circular dependency');
  });

  it('should sort tasks in valid execution order', () => {
    const tasks = [makeTask('c', ['b']), makeTask('b', ['a']), makeTask('a')];
    const dag = buildDag(tasks);
    const sorted = topologicalSort(dag);

    const indexOf = (id: string) => sorted.indexOf(id);
    expect(indexOf('a')).toBeLessThan(indexOf('b'));
    expect(indexOf('b')).toBeLessThan(indexOf('c'));
  });

  it('should handle complex DAG with multiple roots', () => {
    //  a   d
    //  |   |
    //  b   e
    //   \ /
    //    c
    const tasks = [
      makeTask('a'),
      makeTask('b', ['a']),
      makeTask('c', ['b', 'e']),
      makeTask('d'),
      makeTask('e', ['d']),
    ];
    const dag = buildDag(tasks);
    const sorted = topologicalSort(dag);

    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('c'));
    expect(sorted.indexOf('d')).toBeLessThan(sorted.indexOf('e'));
    expect(sorted.indexOf('e')).toBeLessThan(sorted.indexOf('c'));
  });

  it('should include all tasks in sorted output', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c', ['a'])];
    const dag = buildDag(tasks);
    const sorted = topologicalSort(dag);

    expect(sorted.length).toBe(3);
    expect(sorted).toContain('a');
    expect(sorted).toContain('b');
    expect(sorted).toContain('c');
  });

  it('should detect longer cycles (a -> b -> c -> a)', () => {
    const tasks = [makeTask('a', ['c']), makeTask('b', ['a']), makeTask('c', ['b'])];
    const dag = buildDag(tasks);
    expect(() => topologicalSort(dag)).toThrow('Circular dependency');
  });
});

describe('parallel runner — merge lock', () => {
  it('should serialize concurrent operations', async () => {
    // Re-implement the lock for testing (same logic as parallel-runner)
    let merging = false;
    const mergeQueue: Array<() => void> = [];

    async function withMergeLock<T>(fn: () => Promise<T>): Promise<T> {
      while (merging) {
        await new Promise<void>((resolve) => mergeQueue.push(resolve));
      }
      merging = true;
      try {
        return await fn();
      } finally {
        merging = false;
        const next = mergeQueue.shift();
        if (next) next();
      }
    }

    const order: string[] = [];

    const task1 = withMergeLock(async () => {
      order.push('start-1');
      await new Promise((r) => setTimeout(r, 50));
      order.push('end-1');
    });

    const task2 = withMergeLock(async () => {
      order.push('start-2');
      await new Promise((r) => setTimeout(r, 10));
      order.push('end-2');
    });

    const task3 = withMergeLock(async () => {
      order.push('start-3');
      order.push('end-3');
    });

    await Promise.all([task1, task2, task3]);

    // Tasks should be serialized: each "start" is followed by its own "end"
    // before the next "start"
    expect(order[0]).toBe('start-1');
    expect(order[1]).toBe('end-1');
    expect(order[2]).toBe('start-2');
    expect(order[3]).toBe('end-2');
    expect(order[4]).toBe('start-3');
    expect(order[5]).toBe('end-3');
  });

  it('should propagate errors without breaking the lock', async () => {
    let merging = false;
    const mergeQueue: Array<() => void> = [];

    async function withMergeLock<T>(fn: () => Promise<T>): Promise<T> {
      while (merging) {
        await new Promise<void>((resolve) => mergeQueue.push(resolve));
      }
      merging = true;
      try {
        return await fn();
      } finally {
        merging = false;
        const next = mergeQueue.shift();
        if (next) next();
      }
    }

    // Task 1 throws an error — verify the lock is released so task 2 can run
    let task1Error: Error | null = null;
    try {
      await withMergeLock(async () => {
        throw new Error('task1 failed');
      });
    } catch (e) {
      task1Error = e as Error;
    }

    // Error should have propagated
    expect(task1Error).not.toBeNull();
    expect(task1Error!.message).toBe('task1 failed');

    // Lock should be released — task 2 should run without hanging
    const result = await withMergeLock(async () => {
      return 'task2 done';
    });

    expect(result).toBe('task2 done');
  });
});

describe('parallel runner — worktree integration', () => {
  let repoDir: string;

  function initRepo(): string {
    // Use realpathSync to resolve macOS symlinks (/tmp -> /private/tmp)
    // so that paths match what git worktree reports
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sweteam-par-test-')));
    execFileSync('git', ['init', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
    execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init']);
    return dir;
  }

  beforeEach(() => {
    repoDir = initRepo();
  });

  afterEach(() => {
    // Clean up all worktrees
    try {
      const output = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf-8',
      });
      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ') && !line.includes(repoDir.replace(/\/private/, ''))) {
          const wtPath = line.slice('worktree '.length);
          try {
            execFileSync('git', ['-C', repoDir, 'worktree', 'remove', '--force', wtPath]);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('should support concurrent branch creation via worktrees', async () => {
    const { addWorktree, removeWorktree, git } = await import('../git/git.js');

    const wt1 = join(repoDir, '.wt', 'task-1');
    const wt2 = join(repoDir, '.wt', 'task-2');

    // Simulate what the parallel runner does: create worktrees for two tasks
    addWorktree(wt1, 'sw/task-1-impl-auth', 'main', repoDir);
    addWorktree(wt2, 'sw/task-2-add-tests', 'main', repoDir);

    // Both worktrees should be on their respective branches
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], wt1)).toBe('sw/task-1-impl-auth');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], wt2)).toBe('sw/task-2-add-tests');

    // Write files concurrently (simulating coder agents)
    writeFileSync(join(wt1, 'auth.ts'), 'export function auth() {}');
    writeFileSync(join(wt2, 'auth.test.ts'), "test('auth', () => {})");

    // Commit in each worktree independently
    git(['add', '-A'], wt1);
    git(['commit', '-m', 'add auth module'], wt1);
    git(['add', '-A'], wt2);
    git(['commit', '-m', 'add auth tests'], wt2);

    // Merge both into main (simulating the serialized merge phase)
    git(['checkout', 'main'], repoDir);
    git(['merge', '--squash', 'sw/task-1-impl-auth'], repoDir);
    git(['commit', '-m', 'merge task 1'], repoDir);

    git(['merge', '--squash', 'sw/task-2-add-tests'], repoDir);
    git(['commit', '-m', 'merge task 2'], repoDir);

    // Both files should exist in main
    expect(existsSync(join(repoDir, 'auth.ts'))).toBe(true);
    expect(existsSync(join(repoDir, 'auth.test.ts'))).toBe(true);

    // Cleanup
    removeWorktree(wt1, repoDir);
    removeWorktree(wt2, repoDir);
  });

  it('should handle worktree cleanup after task failure', async () => {
    const { addWorktree, removeWorktree, listWorktrees } = await import('../git/git.js');

    const wtPath = join(repoDir, '.wt', 'failing-task');
    addWorktree(wtPath, 'sw/failing-task', 'main', repoDir);

    // Simulate: worktree created but task fails before merge
    expect(existsSync(wtPath)).toBe(true);

    // Cleanup (what the parallel runner does in the finally block)
    removeWorktree(wtPath, repoDir);
    expect(existsSync(wtPath)).toBe(false);

    // Verify no stale worktrees remain
    const worktrees = listWorktrees(repoDir);
    const stale = worktrees.filter((wt: { path: string }) => wt.path.includes('.wt'));
    expect(stale.length).toBe(0);
  });

  it('should isolate changes between worktrees', async () => {
    const { addWorktree, removeWorktree, git } = await import('../git/git.js');

    const wt1 = join(repoDir, '.wt', 'task-a');
    const wt2 = join(repoDir, '.wt', 'task-b');

    addWorktree(wt1, 'sw/task-a', 'main', repoDir);
    addWorktree(wt2, 'sw/task-b', 'main', repoDir);

    // Write a file only in wt1
    writeFileSync(join(wt1, 'only-in-a.ts'), 'export const a = 1;');
    git(['add', '-A'], wt1);
    git(['commit', '-m', 'add file in task a'], wt1);

    // wt2 should NOT see the file from wt1
    expect(existsSync(join(wt2, 'only-in-a.ts'))).toBe(false);

    // main repo should NOT see it either (not merged yet)
    expect(existsSync(join(repoDir, 'only-in-a.ts'))).toBe(false);

    removeWorktree(wt1, repoDir);
    removeWorktree(wt2, repoDir);
  });

  it('should support cleanupWorktrees for batch removal', async () => {
    const { addWorktree, cleanupWorktrees, listWorktrees } = await import('../git/git.js');

    const wtDir = join(repoDir, '.wt');
    const wt1 = join(wtDir, 'task-x');
    const wt2 = join(wtDir, 'task-y');

    addWorktree(wt1, 'sw/task-x', 'main', repoDir);
    addWorktree(wt2, 'sw/task-y', 'main', repoDir);

    // Both should exist
    expect(existsSync(wt1)).toBe(true);
    expect(existsSync(wt2)).toBe(true);

    // Cleanup all worktrees under the .wt directory
    cleanupWorktrees(wtDir, repoDir);

    // Both should be removed
    expect(existsSync(wt1)).toBe(false);
    expect(existsSync(wt2)).toBe(false);

    // No stale worktrees
    const worktrees = listWorktrees(repoDir);
    const remaining = worktrees.filter((wt: { path: string }) => wt.path.includes('.wt'));
    expect(remaining.length).toBe(0);
  });
});
