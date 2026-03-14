import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tasks as tasksTable } from '../db/schema.js';
import { loadConfig } from '../config/loader.js';
import { runTask, type TaskRecord } from './task-runner.js';
import { reviewAndMerge } from './reviewer.js';
import { addMessage, getSession } from '../session/manager.js';
import type { ParsedTask } from '../planner/plan-parser.js';
import { safeJsonParse } from './dag.js';

export interface OrchestratorCallbacks {
  onAgentStart?: (taskId: string, taskTitle: string, role: string) => void;
  onAgentOutput?: (taskId: string, role: string, chunk: string) => void;
  onAgentEnd?: (taskId: string, role: string, success: boolean) => void;
  onInputNeeded?: (taskId: string, role: string, promptText: string) => Promise<string | null>;
}

export interface OrchestratorResult {
  completed: string[];
  failed: string[];
  blocked: string[];
}

/** Scope a plan-level task ID to a session so it is globally unique in the DB. */
export function scopeTaskId(sessionId: string, planTaskId: string): string {
  if (planTaskId.includes(':')) return planTaskId; // already scoped
  return `${sessionId}:${planTaskId}`;
}

/** Strip the session prefix from a scoped task ID for user-facing display. */
export function displayTaskId(dbId: string): string {
  const idx = dbId.indexOf(':');
  const raw = idx >= 0 ? dbId.slice(idx + 1) : dbId;
  // Strip any residual markdown formatting (e.g. **1** → 1)
  return raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

export function insertTasksFromPlan(
  sessionId: string,
  parsedTasks: ParsedTask[],
  orderOffset: number = 0,
): void {
  const db = getDb();
  const now = new Date();

  // Build a map from plan IDs to session-scoped DB IDs
  const idMap = new Map<string, string>();
  for (const t of parsedTasks) {
    idMap.set(t.id, scopeTaskId(sessionId, t.id));
  }

  for (let i = 0; i < parsedTasks.length; i++) {
    const t = parsedTasks[i];
    const dbId = idMap.get(t.id)!;
    const scopedDeps = t.dependsOn.map((dep) => idMap.get(dep) ?? scopeTaskId(sessionId, dep));

    db.insert(tasksTable)
      .values({
        id: dbId,
        sessionId,
        title: t.title,
        description: t.description,
        status: 'queued',
        dependsOn: scopedDeps.length > 0 ? JSON.stringify(scopedDeps) : null,
        filesLikelyTouched:
          t.filesLikelyTouched.length > 0 ? JSON.stringify(t.filesLikelyTouched) : null,
        acceptanceCriteria:
          t.acceptanceCriteria.length > 0 ? JSON.stringify(t.acceptanceCriteria) : null,
        order: orderOffset + i + 1,
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

function areDependenciesMet(task: TaskRecord, completedIds: Set<string>): boolean {
  if (!task.dependsOn) return true;

  const deps: string[] = safeJsonParse(task.dependsOn, []);
  return deps.every((depId) => completedIds.has(depId));
}

function markBlockedTasks(failedId: string, allTasks: TaskRecord[]): string[] {
  const db = getDb();
  const blocked: string[] = [];

  for (const task of allTasks) {
    if (task.status !== 'queued') continue;
    if (!task.dependsOn) continue;

    const deps: string[] = safeJsonParse(task.dependsOn, []);
    if (deps.includes(failedId)) {
      db.update(tasksTable)
        .set({ status: 'blocked', updatedAt: new Date() })
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
  options?: { images?: string[] },
): Promise<OrchestratorResult> {
  // Support legacy single-function signature
  const cb: OrchestratorCallbacks =
    typeof callbacks === 'function'
      ? { onAgentOutput: (_taskId, _role, chunk) => callbacks(chunk) }
      : (callbacks ?? {});

  const config = loadConfig();
  const completed: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];

  const allTasks = getTasksForSession(sessionId);
  const completedIds = new Set<string>();
  const failedIds = new Set<string>();
  const blockedIds = new Set<string>();
  let stopped = false;

  // Pre-populate from existing statuses (e.g. resumed builds)
  for (const task of allTasks) {
    if (task.status === 'done') {
      completedIds.add(task.id);
      completed.push(task.id);
    }
  }

  // Multi-pass sequential execution: keep looping until no progress is made
  // This ensures tasks whose dependencies come later in the list are still processed
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;

    for (const task of allTasks) {
      // Check if session was stopped
      const session = getSession(sessionId);
      if (session?.status === 'stopped') {
        addMessage(sessionId, 'system', 'Build cancelled — session stopped.');
        stopped = true;
        break;
      }

      // Skip non-queued tasks (already completed, failed, blocked, or in progress)
      if (task.status !== 'queued') continue;
      // Skip tasks already processed in this run
      if (completedIds.has(task.id) || failedIds.has(task.id) || blockedIds.has(task.id)) continue;

      // Check dependencies
      if (!areDependenciesMet(task, completedIds)) {
        const deps: string[] = safeJsonParse(task.dependsOn!, []);
        const unmetDeps = deps.filter((d) => !completedIds.has(d));
        const anyFailed = unmetDeps.some((d) => failedIds.has(d) || blockedIds.has(d));

        if (anyFailed) {
          const db = getDb();
          db.update(tasksTable)
            .set({ status: 'blocked', updatedAt: new Date() })
            .where(eq(tasksTable.id, task.id))
            .run();
          task.status = 'blocked';
          blockedIds.add(task.id);
          blocked.push(task.id);
          madeProgress = true;
          addMessage(
            sessionId,
            'system',
            `Task ${displayTaskId(task.id)} blocked: dependency failed`,
          );
        }
        // Dependencies not yet met — skip this task for now, revisit next pass
        continue;
      }

      // Run the task — Coder phase
      madeProgress = true;
      addMessage(sessionId, 'system', `Starting task ${displayTaskId(task.id)}: ${task.title}`);

      cb.onAgentStart?.(task.id, task.title, 'Coder');
      const coderOutput = cb.onAgentOutput
        ? (chunk: string) => cb.onAgentOutput!(task.id, 'Coder', chunk)
        : undefined;
      const coderInputNeeded = cb.onInputNeeded
        ? (promptText: string) => cb.onInputNeeded!(task.id, 'Coder', promptText)
        : undefined;

      const result = await runTask(task, sessionBranch, repoPath, coderOutput, coderInputNeeded, {
        images: options?.images,
      });
      cb.onAgentEnd?.(task.id, 'Coder', result.success);

      if (!result.success) {
        failedIds.add(task.id);
        failed.push(task.id);
        task.status = 'failed';
        const newBlocked = markBlockedTasks(task.id, allTasks);
        blocked.push(...newBlocked);
        for (const b of newBlocked) blockedIds.add(b);
        addMessage(
          sessionId,
          'system',
          `Task ${displayTaskId(task.id)} failed: ${result.output.slice(0, 500)}`,
        );
        continue;
      }

      // Review and merge — Reviewer phase
      // Reload task from DB (it was updated by runTask)
      const updatedTasks = getTasksForSession(sessionId);
      const updatedTask = updatedTasks.find((t) => t.id === task.id)!;

      cb.onAgentStart?.(task.id, task.title, 'Reviewer');
      const reviewerOutput = cb.onAgentOutput
        ? (chunk: string) => cb.onAgentOutput!(task.id, 'Reviewer', chunk)
        : undefined;
      const reviewerInputNeeded = cb.onInputNeeded
        ? (promptText: string) => cb.onInputNeeded!(task.id, 'Reviewer', promptText)
        : undefined;

      const reviewResult = await reviewAndMerge(
        updatedTask,
        sessionBranch,
        repoPath,
        config.execution.max_review_cycles,
        reviewerOutput,
        reviewerInputNeeded,
        { images: options?.images },
      );
      cb.onAgentEnd?.(task.id, 'Reviewer', reviewResult.merged);

      if (reviewResult.merged) {
        completedIds.add(task.id);
        completed.push(task.id);
        task.status = 'done';
        addMessage(sessionId, 'system', `Task ${displayTaskId(task.id)} completed and merged`);
      } else {
        failedIds.add(task.id);
        failed.push(task.id);
        task.status = 'failed';
        const newBlocked = markBlockedTasks(task.id, allTasks);
        blocked.push(...newBlocked);
        for (const b of newBlocked) blockedIds.add(b);
        addMessage(
          sessionId,
          'system',
          `Task ${displayTaskId(task.id)} failed review after ${config.execution.max_review_cycles} cycles`,
        );
      }
    }

    if (stopped) break;
  }

  // Bug #19: If stopped or if any tasks remain pending with no progress,
  // cancel tasks stuck in running/reviewing status
  if (stopped) {
    const db = getDb();
    const stuckTasks = getTasksForSession(sessionId).filter(
      (t) => t.status === 'running' || t.status === 'reviewing',
    );
    for (const t of stuckTasks) {
      db.update(tasksTable)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(tasksTable.id, t.id))
        .run();
    }
  }

  // Mark any remaining queued tasks as blocked (no progress could be made)
  {
    const db = getDb();
    for (const task of allTasks) {
      if (
        task.status === 'queued' &&
        !completedIds.has(task.id) &&
        !failedIds.has(task.id) &&
        !blockedIds.has(task.id)
      ) {
        db.update(tasksTable)
          .set({ status: 'blocked', updatedAt: new Date() })
          .where(eq(tasksTable.id, task.id))
          .run();
        blockedIds.add(task.id);
        blocked.push(task.id);
        addMessage(
          sessionId,
          'system',
          `Task ${displayTaskId(task.id)} blocked: unresolvable dependencies`,
        );
      }
    }
  }

  return { completed, failed, blocked };
}
