import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks as tasksTable, sessions } from "../db/schema.js";
import { loadConfig } from "../config/loader.js";
import { runTask, type TaskRecord } from "./task-runner.js";
import { reviewAndMerge } from "./reviewer.js";
import { addMessage } from "../session/manager.js";
import type { ParsedTask } from "../planner/plan-parser.js";

export interface OrchestratorCallbacks {
  onAgentStart?: (taskId: string, taskTitle: string, role: string) => void;
  onAgentOutput?: (taskId: string, role: string, chunk: string) => void;
  onAgentEnd?: (taskId: string, role: string, success: boolean) => void;
}

export interface OrchestratorResult {
  completed: string[];
  failed: string[];
  blocked: string[];
}

export function insertTasksFromPlan(
  sessionId: string,
  parsedTasks: ParsedTask[],
): void {
  const db = getDb();
  const now = new Date();

  for (let i = 0; i < parsedTasks.length; i++) {
    const t = parsedTasks[i];
    db.insert(tasksTable)
      .values({
        id: t.id,
        sessionId,
        title: t.title,
        description: t.description,
        status: "queued",
        dependsOn:
          t.dependsOn.length > 0 ? JSON.stringify(t.dependsOn) : null,
        filesLikelyTouched:
          t.filesLikelyTouched.length > 0
            ? JSON.stringify(t.filesLikelyTouched)
            : null,
        acceptanceCriteria:
          t.acceptanceCriteria.length > 0
            ? JSON.stringify(t.acceptanceCriteria)
            : null,
        order: i + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function getTasksForSession(sessionId: string): TaskRecord[] {
  const db = getDb();
  return db
    .select({
      id: tasksTable.id,
      sessionId: tasksTable.sessionId,
      title: tasksTable.title,
      description: tasksTable.description,
      filesLikelyTouched: tasksTable.filesLikelyTouched,
      acceptanceCriteria: tasksTable.acceptanceCriteria,
      dependsOn: tasksTable.dependsOn,
      branchName: tasksTable.branchName,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(tasksTable.order)
    .all();
}

function areDependenciesMet(
  task: TaskRecord,
  completedIds: Set<string>,
): boolean {
  if (!task.dependsOn) return true;

  const deps: string[] = JSON.parse(task.dependsOn);
  return deps.every((depId) => completedIds.has(depId));
}

function markBlockedTasks(
  failedId: string,
  allTasks: TaskRecord[],
): string[] {
  const db = getDb();
  const blocked: string[] = [];

  for (const task of allTasks) {
    if (task.status !== "queued") continue;
    if (!task.dependsOn) continue;

    const deps: string[] = JSON.parse(task.dependsOn);
    if (deps.includes(failedId)) {
      db.update(tasksTable)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(tasksTable.id, task.id))
        .run();
      blocked.push(task.id);

      // Recursively block downstream
      blocked.push(...markBlockedTasks(task.id, allTasks));
    }
  }

  return blocked;
}

export async function runOrchestrator(
  sessionId: string,
  repoPath: string,
  sessionBranch: string,
  callbacks?: OrchestratorCallbacks | ((chunk: string) => void),
): Promise<OrchestratorResult> {
  // Support legacy single-function signature
  const cb: OrchestratorCallbacks =
    typeof callbacks === "function"
      ? { onAgentOutput: (_taskId, _role, chunk) => callbacks(chunk) }
      : callbacks ?? {};

  const config = loadConfig();
  const completed: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];

  const allTasks = getTasksForSession(sessionId);
  const completedIds = new Set<string>();

  // Sequential execution in dependency order
  for (const task of allTasks) {
    // Skip non-queued tasks
    if (task.status !== "queued") {
      if (task.status === "done") {
        completedIds.add(task.id);
        completed.push(task.id);
      }
      continue;
    }

    // Check dependencies
    if (!areDependenciesMet(task, completedIds)) {
      const deps: string[] = JSON.parse(task.dependsOn!);
      const unmetDeps = deps.filter((d) => !completedIds.has(d));
      const anyFailed = unmetDeps.some((d) => failed.includes(d) || blocked.includes(d));

      if (anyFailed) {
        const db = getDb();
        db.update(tasksTable)
          .set({ status: "blocked", updatedAt: new Date() })
          .where(eq(tasksTable.id, task.id))
          .run();
        blocked.push(task.id);
        addMessage(
          sessionId,
          "system",
          `Task ${task.id} blocked: dependency failed`,
        );
        continue;
      }
    }

    // Run the task — Coder phase
    addMessage(sessionId, "system", `Starting task ${task.id}: ${task.title}`);

    cb.onAgentStart?.(task.id, task.title, "Coder");
    const coderOutput = cb.onAgentOutput
      ? (chunk: string) => cb.onAgentOutput!(task.id, "Coder", chunk)
      : undefined;

    const result = await runTask(task, sessionBranch, repoPath, coderOutput);
    cb.onAgentEnd?.(task.id, "Coder", result.success);

    if (!result.success) {
      failed.push(task.id);
      const newBlocked = markBlockedTasks(task.id, allTasks);
      blocked.push(...newBlocked);
      addMessage(
        sessionId,
        "system",
        `Task ${task.id} failed: ${result.output.slice(0, 200)}`,
      );
      continue;
    }

    // Review and merge — Reviewer phase
    // Reload task from DB (it was updated by runTask)
    const updatedTasks = getTasksForSession(sessionId);
    const updatedTask = updatedTasks.find((t) => t.id === task.id)!;

    cb.onAgentStart?.(task.id, task.title, "Reviewer");
    const reviewerOutput = cb.onAgentOutput
      ? (chunk: string) => cb.onAgentOutput!(task.id, "Reviewer", chunk)
      : undefined;

    const reviewResult = await reviewAndMerge(
      updatedTask,
      sessionBranch,
      repoPath,
      config.execution.max_review_cycles,
      reviewerOutput,
    );
    cb.onAgentEnd?.(task.id, "Reviewer", reviewResult.merged);

    if (reviewResult.merged) {
      completedIds.add(task.id);
      completed.push(task.id);
      addMessage(sessionId, "system", `Task ${task.id} completed and merged`);
    } else {
      failed.push(task.id);
      const newBlocked = markBlockedTasks(task.id, allTasks);
      blocked.push(...newBlocked);
      addMessage(
        sessionId,
        "system",
        `Task ${task.id} failed review after ${config.execution.max_review_cycles} cycles`,
      );
    }
  }

  return { completed, failed, blocked };
}
