import { eq } from "drizzle-orm";
import { join } from "path";
import { homedir } from "os";
import { getDb } from "../db/client.js";
import { tasks as tasksTable } from "../db/schema.js";
import { loadConfig } from "../config/loader.js";
import { addMessage, getSession } from "../session/manager.js";
import { runTask, type TaskRecord } from "./task-runner.js";
import { reviewAndMerge } from "./reviewer.js";
import { buildDag, getReadyTasks, topologicalSort } from "./dag.js";
import {
  getTasksForSession,
  displayTaskId,
  type OrchestratorCallbacks,
  type OrchestratorResult,
} from "./orchestrator.js";
import { addWorktree, removeWorktree, cleanupWorktrees, git } from "../git/git.js";

const WORKTREE_DIR = join(homedir(), ".sweteam", "worktrees");

/** Mutex for serializing merge operations on the shared session branch. */
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

/** Recursively mark all downstream dependents as blocked in memory and DB. */
function markBlockedRecursive(
  failedId: string,
  dag: Map<string, import("./dag.js").DagNode>,
  blockedIds: Set<string>,
): void {
  const db = getDb();
  const node = dag.get(failedId);
  if (!node) return;

  for (const depId of node.dependents) {
    if (blockedIds.has(depId)) continue;
    blockedIds.add(depId);
    db.update(tasksTable)
      .set({ status: "blocked", updatedAt: new Date() })
      .where(eq(tasksTable.id, depId))
      .run();
    markBlockedRecursive(depId, dag, blockedIds);
  }
}

/**
 * Run tasks in parallel using git worktrees for isolation.
 *
 * Each task gets its own worktree (a separate working directory backed by
 * the same git object store).  Coder agents run concurrently in isolated
 * worktrees.  Merges into the session branch are serialized via a lock.
 */
export async function runParallelOrchestrator(
  sessionId: string,
  repoPath: string,
  sessionBranch: string,
  callbacks?: OrchestratorCallbacks,
): Promise<OrchestratorResult> {
  const config = loadConfig();
  const maxParallel = config.execution.max_parallel;
  const maxReviewCycles = config.execution.max_review_cycles;
  const cb = callbacks ?? {};

  const allTasks = getTasksForSession(sessionId);
  const dag = buildDag(allTasks);

  // Validate no circular dependencies before starting
  topologicalSort(dag);

  const completed = new Set<string>();
  const failed = new Set<string>();
  const blocked = new Set<string>();
  const running = new Map<string, Promise<void>>();

  // Pre-populate from existing statuses (e.g. resumed builds)
  for (const task of allTasks) {
    if (task.status === "done") completed.add(task.id);
    if (task.status === "failed") failed.add(task.id);
    if (task.status === "blocked") blocked.add(task.id);
  }

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  // Worktree directory for this session
  const sessionWtDir = join(
    WORKTREE_DIR,
    sessionId.replace(/[^a-zA-Z0-9_-]/g, "-"),
  );

  try {
    while (true) {
      // Check if session was stopped
      const session = getSession(sessionId);
      if (session?.status === "stopped") {
        addMessage(sessionId, "system", "Build cancelled — session stopped.");
        break;
      }

      const runningIds = new Set(running.keys());
      const ready = getReadyTasks(dag, completed, runningIds, failed, blocked);

      if (ready.length === 0 && running.size === 0) break;

      // Launch tasks up to max_parallel
      const slotsAvailable = maxParallel - running.size;
      const toLaunch = ready.slice(0, slotsAvailable);

      for (const taskId of toLaunch) {
        const task = taskMap.get(taskId)!;

        const taskPromise = (async () => {
          const safeBranchId = task.id
            .replace(/:/g, "-")
            .replace(/[^a-zA-Z0-9/_-]/g, "");
          const slug = task.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 30);
          const branchName = `sw/${safeBranchId}-${slug}`;
          const worktreePath = join(sessionWtDir, safeBranchId);

          try {
            // Create isolated worktree
            addWorktree(worktreePath, branchName, sessionBranch, repoPath);

            addMessage(
              sessionId,
              "system",
              `Starting task ${displayTaskId(task.id)}: ${task.title}`,
            );

            // ── Coder phase ──
            cb.onAgentStart?.(task.id, task.title, "Coder");
            const coderOutput = cb.onAgentOutput
              ? (chunk: string) => cb.onAgentOutput!(task.id, "Coder", chunk)
              : undefined;
            const coderInput = cb.onInputNeeded
              ? (pt: string) => cb.onInputNeeded!(task.id, "Coder", pt)
              : undefined;

            const result = await runTask(
              task,
              sessionBranch,
              repoPath,
              coderOutput,
              coderInput,
              { worktreePath },
            );
            cb.onAgentEnd?.(task.id, "Coder", result.success);

            if (!result.success) {
              failed.add(taskId);
              markBlockedRecursive(taskId, dag, blocked);
              addMessage(
                sessionId,
                "system",
                `Task ${displayTaskId(task.id)} failed: ${result.output.slice(0, 500)}`,
              );
              return;
            }

            // ── Reviewer phase ──
            const updatedTasks = getTasksForSession(sessionId);
            const updatedTask = updatedTasks.find((t) => t.id === task.id)!;

            cb.onAgentStart?.(task.id, task.title, "Reviewer");
            const reviewerOutput = cb.onAgentOutput
              ? (chunk: string) => cb.onAgentOutput!(task.id, "Reviewer", chunk)
              : undefined;
            const reviewerInput = cb.onInputNeeded
              ? (pt: string) => cb.onInputNeeded!(task.id, "Reviewer", pt)
              : undefined;

            const reviewResult = await reviewAndMerge(
              updatedTask,
              sessionBranch,
              repoPath,
              maxReviewCycles,
              reviewerOutput,
              reviewerInput,
              { taskCwd: worktreePath, withMergeLock },
            );
            cb.onAgentEnd?.(task.id, "Reviewer", reviewResult.merged);

            if (reviewResult.merged) {
              completed.add(taskId);
              addMessage(
                sessionId,
                "system",
                `Task ${displayTaskId(task.id)} completed and merged`,
              );
            } else {
              failed.add(taskId);
              markBlockedRecursive(taskId, dag, blocked);
              addMessage(
                sessionId,
                "system",
                `Task ${displayTaskId(task.id)} failed review after ${maxReviewCycles} cycles`,
              );
            }
          } finally {
            // Always clean up worktree
            try {
              removeWorktree(worktreePath, repoPath);
            } catch { /* best effort */ }
            // Delete the task branch if it wasn't merged
            if (!completed.has(taskId)) {
              try {
                git(["branch", "-D", branchName], repoPath);
              } catch { /* ignore */ }
            }
            running.delete(taskId);
          }
        })();

        running.set(taskId, taskPromise);
      }

      if (running.size > 0) {
        // Wait for at least one task to complete before checking for new ready tasks
        await Promise.race(running.values());
      }
    }

    // Wait for any remaining tasks to complete
    if (running.size > 0) {
      await Promise.allSettled(running.values());
    }
  } finally {
    // Clean up all worktrees for this session
    try {
      cleanupWorktrees(sessionWtDir, repoPath);
    } catch { /* best effort */ }
  }

  return {
    completed: [...completed],
    failed: [...failed],
    blocked: [...blocked],
  };
}
