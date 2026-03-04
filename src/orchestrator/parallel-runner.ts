import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks as tasksTable } from "../db/schema.js";
import { loadConfig } from "../config/loader.js";
import { addMessage } from "../session/manager.js";
import { runTask, type TaskRecord } from "./task-runner.js";
import { reviewAndMerge } from "./reviewer.js";
import { buildDag, getReadyTasks } from "./dag.js";
import { getTasksForSession, displayTaskId, type OrchestratorResult } from "./orchestrator.js";

// Mutex for serializing merge operations
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

async function runSingleTask(
  task: TaskRecord,
  sessionBranch: string,
  repoPath: string,
  sessionId: string,
  maxReviewCycles: number,
): Promise<{ taskId: string; success: boolean }> {
  addMessage(sessionId, "system", `Starting task ${displayTaskId(task.id)}: ${task.title}`);

  const result = await runTask(task, sessionBranch, repoPath);

  if (!result.success) {
    return { taskId: task.id, success: false };
  }

  // Reload task from DB
  const updatedTasks = getTasksForSession(sessionId);
  const updatedTask = updatedTasks.find((t) => t.id === task.id)!;

  // Serialize merge operations
  const reviewResult = await withMergeLock(async () => {
    return reviewAndMerge(
      updatedTask,
      sessionBranch,
      repoPath,
      maxReviewCycles,
    );
  });

  if (reviewResult.merged) {
    addMessage(sessionId, "system", `Task ${displayTaskId(task.id)} completed and merged`);
    return { taskId: task.id, success: true };
  }

  return { taskId: task.id, success: false };
}

export async function runParallelOrchestrator(
  sessionId: string,
  repoPath: string,
  sessionBranch: string,
): Promise<OrchestratorResult> {
  const config = loadConfig();
  const maxParallel = config.execution.max_parallel;
  const maxReviewCycles = config.execution.max_review_cycles;

  const allTasks = getTasksForSession(sessionId);
  const dag = buildDag(allTasks);

  const completed = new Set<string>();
  const failed = new Set<string>();
  const blocked = new Set<string>();
  const running = new Set<string>();

  // Pre-populate from existing statuses
  for (const task of allTasks) {
    if (task.status === "done") completed.add(task.id);
    if (task.status === "failed") failed.add(task.id);
    if (task.status === "blocked") blocked.add(task.id);
  }

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  while (true) {
    const ready = getReadyTasks(dag, completed, running, failed, blocked);

    if (ready.length === 0 && running.size === 0) {
      break;
    }

    // Launch tasks up to max_parallel
    const toLaunch = ready.slice(0, maxParallel - running.size);

    if (toLaunch.length === 0 && running.size > 0) {
      // Wait for any running task to complete
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    const promises = toLaunch.map(async (taskId) => {
      running.add(taskId);

      const task = taskMap.get(taskId)!;
      const result = await runSingleTask(
        task,
        sessionBranch,
        repoPath,
        sessionId,
        maxReviewCycles,
      );

      running.delete(taskId);

      if (result.success) {
        completed.add(taskId);
      } else {
        failed.add(taskId);
        // Block dependents
        const db = getDb();
        const node = dag.get(taskId);
        if (node) {
          for (const depId of node.dependents) {
            blocked.add(depId);
            db.update(tasksTable)
              .set({ status: "blocked", updatedAt: new Date() })
              .where(eq(tasksTable.id, depId))
              .run();
          }
        }
      }
    });

    await Promise.all(promises);
  }

  return {
    completed: [...completed],
    failed: [...failed],
    blocked: [...blocked],
  };
}
