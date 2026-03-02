import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks as tasksTable } from "../db/schema.js";
import { addMessage } from "../session/manager.js";
import { resolveAdapter } from "../adapters/adapter.js";
import { loadConfig } from "../config/loader.js";
import { git } from "../git/git.js";
import type { TaskRecord } from "./task-runner.js";

export async function executeWithRetry(
  adapter: ReturnType<typeof resolveAdapter>,
  opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
  },
  taskId: string,
  sessionId: string,
): Promise<{ output: string; exitCode: number; durationMs: number }> {
  const timeout = opts.timeout ?? 300000;

  try {
    const result = await adapter.execute({ ...opts, timeout });

    if (result.exitCode !== 0) {
      // First failure — retry with error context
      addMessage(
        sessionId,
        "system",
        `Task ${taskId}: agent exited with code ${result.exitCode}, retrying with error context...`,
      );

      const retryPrompt = `${opts.prompt}\n\n## Previous Attempt Failed\nThe previous attempt produced this error:\n${result.output.slice(0, 1000)}\n\nPlease fix the issues and try again.`;

      const retryResult = await adapter.execute({
        ...opts,
        prompt: retryPrompt,
        timeout,
      });

      if (retryResult.exitCode !== 0) {
        addMessage(
          sessionId,
          "system",
          `Task ${taskId}: retry also failed (exit code ${retryResult.exitCode})`,
        );
      }

      return retryResult;
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Check if timeout
    if (message.includes("timed out")) {
      addMessage(
        sessionId,
        "system",
        `Task ${taskId}: timed out after ${timeout}ms, retrying once...`,
      );

      try {
        const retryResult = await adapter.execute({ ...opts, timeout });
        return retryResult;
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        addMessage(
          sessionId,
          "system",
          `Task ${taskId}: retry also timed out: ${retryMsg}`,
        );
        throw retryErr;
      }
    }

    throw err;
  }
}

export function propagateFailure(
  failedTaskId: string,
  sessionId: string,
  allTasks: TaskRecord[],
): string[] {
  const db = getDb();
  const blocked: string[] = [];

  for (const task of allTasks) {
    if (task.status !== "queued") continue;
    if (!task.dependsOn) continue;

    const deps: string[] = JSON.parse(task.dependsOn);
    if (deps.includes(failedTaskId)) {
      db.update(tasksTable)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(tasksTable.id, task.id))
        .run();

      blocked.push(task.id);
      addMessage(
        sessionId,
        "system",
        `Task ${task.id} blocked: dependency ${failedTaskId} failed`,
      );

      // Recursively block downstream
      blocked.push(...propagateFailure(task.id, sessionId, allTasks));
    }
  }

  return blocked;
}

export function attemptMergeConflictResolution(
  repoPath: string,
  taskId: string,
  sessionId: string,
): boolean {
  try {
    // Check for conflicts
    const status = git("status --porcelain", repoPath);
    const hasConflicts = status
      .split("\n")
      .some((line) => line.startsWith("UU") || line.startsWith("AA"));

    if (!hasConflicts) return true;

    addMessage(
      sessionId,
      "system",
      `Task ${taskId}: merge conflict detected, attempting auto-resolution...`,
    );

    // Try to resolve by accepting the incoming changes
    try {
      git("checkout --theirs .", repoPath);
      git("add -A", repoPath);
      return true;
    } catch {
      addMessage(
        sessionId,
        "system",
        `Task ${taskId}: auto-resolution failed, escalating`,
      );
      return false;
    }
  } catch {
    return false;
  }
}

export function persistError(
  sessionId: string,
  taskId: string,
  error: string,
  phase: string,
): void {
  addMessage(
    sessionId,
    "system",
    `[${phase}] Task ${taskId} error: ${error}`,
  );

  const db = getDb();
  db.update(tasksTable)
    .set({
      status: "failed",
      agentOutput: `[${phase}] ${error}`,
      updatedAt: new Date(),
    })
    .where(eq(tasksTable.id, taskId))
    .run();
}
