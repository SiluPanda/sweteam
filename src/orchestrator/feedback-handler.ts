import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { iterations, sessions, tasks as tasksTable } from '../db/schema.js';
import { transition } from '../session/state-machine.js';
import { addMessage, getSession } from '../session/manager.js';
import { resolveAdapter } from '../adapters/adapter.js';
import { loadConfig } from '../config/loader.js';
import {
  getTasksForSession,
  insertTasksFromPlan,
  runOrchestrator,
  scopeTaskId,
  type OrchestratorCallbacks,
} from './orchestrator.js';
import {
  pushBranch,
  createPR,
  getDefaultBranch,
  git,
  deleteBranches,
  cleanupWorktrees,
} from '../git/git.js';
import { runParallelOrchestrator } from './parallel-runner.js';
import { clearLog, writeEvent } from '../session/agent-log.js';

export interface PlanDelta {
  modifiedTasks: Array<{ id: string; changes: string }>;
  newTasks: Array<{
    id: string;
    title: string;
    description: string;
    filesLikelyTouched: string[];
    dependsOn: string[];
    acceptanceCriteria: string[];
  }>;
  summary: string;
}

export function buildFeedbackPrompt(
  planJson: string,
  allTasks: Array<{
    id: string;
    title: string;
    status: string;
    description: string;
    diffPatch: string | null;
  }>,
  feedbackText: string,
  iterationHistory: Array<{
    iterationNumber: number;
    feedback: string;
    planDelta: string | null;
  }>,
): string {
  const tasksSummary = allTasks
    .map(
      (t) =>
        `- ${t.id} [${t.status}]: ${t.title}\n  ${t.description}${t.diffPatch ? `\n  Diff: ${t.diffPatch.slice(0, 500)}` : ''}`,
    )
    .join('\n');

  const historyText =
    iterationHistory.length > 0
      ? iterationHistory
          .map(
            (i) =>
              `Iteration ${i.iterationNumber}: ${i.feedback}${i.planDelta ? `\nDelta: ${i.planDelta}` : ''}`,
          )
          .join('\n\n')
      : '(first iteration)';

  return `The user has reviewed the PR and has feedback. Determine what needs to change.

## Original Plan
${planJson}

## Current State of Tasks
${tasksSummary}

## User Feedback
${feedbackText}

## Previous Iterations
${historyText}

Respond with ONLY valid JSON — a plan delta:
{
  "modified_tasks": [
    { "id": "task-003", "changes": "Description of what to change" }
  ],
  "new_tasks": [
    { "id": "task-007", "title": "...", "description": "...", "files_likely_touched": [], "depends_on": [], "acceptance_criteria": [] }
  ],
  "summary": "What's changing and why"
}`;
}

export function parsePlanDelta(output: string): PlanDelta {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : output;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      modifiedTasks: Array.isArray(parsed.modified_tasks) ? parsed.modified_tasks : [],
      newTasks: Array.isArray(parsed.new_tasks)
        ? parsed.new_tasks.map((t: Record<string, unknown>) => ({
            id: String(t.id ?? `task-${nanoid(4)}`),
            title: String(t.title ?? ''),
            description: String(t.description ?? ''),
            filesLikelyTouched: Array.isArray(t.files_likely_touched)
              ? t.files_likely_touched.map(String)
              : [],
            dependsOn: Array.isArray(t.depends_on) ? t.depends_on.map(String) : [],
            acceptanceCriteria: Array.isArray(t.acceptance_criteria)
              ? t.acceptance_criteria.map(String)
              : [],
          }))
        : [],
      summary: String(parsed.summary ?? ''),
    };
  } catch {
    return {
      modifiedTasks: [],
      newTasks: [],
      summary: 'Could not parse plan delta from agent response.',
    };
  }
}

export function applyPlanDelta(sessionId: string, delta: PlanDelta): void {
  const db = getDb();

  // Re-queue modified tasks — append changes to existing description
  for (const mod of delta.modifiedTasks) {
    const dbId = scopeTaskId(sessionId, mod.id);
    // Read existing description to append changes rather than overwrite
    const existing = db
      .select({ description: tasksTable.description })
      .from(tasksTable)
      .where(eq(tasksTable.id, dbId))
      .all();
    const existingDesc = existing.length > 0 ? existing[0].description : '';
    const updatedDesc = existingDesc
      ? `${existingDesc}\n\n--- Feedback Changes ---\n${mod.changes}`
      : mod.changes;

    db.update(tasksTable)
      .set({
        status: 'queued',
        description: updatedDesc,
        reviewVerdict: null,
        reviewIssues: null,
        reviewCycles: 0,
        diffPatch: null,
        agentOutput: null,
        branchName: null,
        updatedAt: new Date(),
      })
      .where(eq(tasksTable.id, dbId))
      .run();
  }

  // Insert new tasks with correct order offset
  if (delta.newTasks.length > 0) {
    const existing = getTasksForSession(sessionId);
    const maxOrder = existing.length;

    insertTasksFromPlan(
      sessionId,
      delta.newTasks.map((t) => ({
        ...t,
      })),
      maxOrder,
    );
  }
}

export function createIteration(
  sessionId: string,
  feedbackText: string,
  planDelta: PlanDelta | null,
): number {
  const db = getDb();

  // Get next iteration number
  const existing = db
    .select({ iterationNumber: iterations.iterationNumber })
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .all();

  const nextNumber =
    existing.length > 0 ? Math.max(...existing.map((i) => i.iterationNumber)) + 1 : 1;

  db.insert(iterations)
    .values({
      id: nanoid(),
      sessionId,
      iterationNumber: nextNumber,
      feedback: feedbackText,
      planDelta: planDelta ? JSON.stringify(planDelta) : null,
      status: 'building',
      createdAt: new Date(),
    })
    .run();

  return nextNumber;
}

export function getIterationHistory(sessionId: string) {
  const db = getDb();
  return db
    .select({
      iterationNumber: iterations.iterationNumber,
      feedback: iterations.feedback,
      planDelta: iterations.planDelta,
    })
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .orderBy(iterations.iterationNumber)
    .all();
}

/**
 * Re-queue any incomplete tasks so the orchestrator retries them.
 * Covers failed/blocked tasks AND tasks stuck in intermediate states
 * (running/reviewing/fixing) from interrupted builds (crash, stop, timeout).
 */
export function requeueIncompleteTasks(sessionId: string): void {
  const db = getDb();
  const requeableStatuses = new Set(['failed', 'blocked', 'running', 'reviewing', 'fixing']);
  const remainingTasks = getTasksForSession(sessionId);
  const session = getSession(sessionId);
  const repoPath = session?.repoLocalPath;

  for (const t of remainingTasks) {
    if (requeableStatuses.has(t.status)) {
      // Delete the old branch before clearing branchName to avoid orphaned branches
      if (t.branchName && repoPath) {
        try {
          git(['branch', '-D', t.branchName], repoPath);
        } catch {
          // Branch may not exist or may already be deleted — that's fine
        }
      }

      db.update(tasksTable)
        .set({
          status: 'queued',
          reviewVerdict: null,
          reviewIssues: null,
          reviewCycles: 0,
          diffPatch: null,
          agentOutput: null,
          branchName: null,
          updatedAt: new Date(),
        })
        .where(eq(tasksTable.id, t.id))
        .run();
    }
  }
}

export async function handleFeedback(sessionId: string, feedbackText: string, images?: string[]): Promise<void> {
  const config = loadConfig();
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  // Store feedback
  addMessage(sessionId, 'user', feedbackText, { type: 'feedback' });

  // Transition to iterating
  transition(sessionId, 'iterating');

  // Get current state
  const db = getDb();
  const allTasks = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      description: tasksTable.description,
      diffPatch: tasksTable.diffPatch,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .all();

  // If all tasks are still queued (build never ran), skip the planner delta
  // and just re-run the orchestrator directly
  const allQueued = allTasks.length > 0 && allTasks.every((t) => t.status === 'queued');

  // Clear log file so watchers from other processes start fresh
  clearLog(sessionId);

  let agentCounter = 0;

  if (!allQueued) {
    const iterHistory = getIterationHistory(sessionId);

    // Build feedback prompt and invoke planner
    const prompt = buildFeedbackPrompt(
      session.planJson ?? '{}',
      allTasks,
      feedbackText,
      iterHistory,
    );

    // Planner phase
    const plannerId = 'planner-1';
    writeEvent(sessionId, {
      type: 'agent-start',
      id: plannerId,
      role: 'Planner',
      taskId: sessionId,
      title: 'Analyzing feedback',
    });
    agentCounter++;
    const adapter = resolveAdapter(config.roles.planner, config);
    let result: { output: string };
    try {
      result = await adapter.execute({
        prompt,
        cwd: session.repoLocalPath ?? '.',
        timeout: 0,
        images,
        onOutput: (chunk: string) => {
          writeEvent(sessionId, { type: 'output', id: plannerId, chunk });
        },
      });
      writeEvent(sessionId, { type: 'agent-end', id: plannerId, success: true });
    } catch (plannerErr) {
      writeEvent(sessionId, { type: 'agent-end', id: plannerId, success: false });
      // Restore session to awaiting_feedback so the user can retry
      try {
        transition(sessionId, 'awaiting_feedback');
      } catch {
        /* may already be transitioned */
      }
      throw plannerErr;
    }

    // Parse the plan delta
    const delta = parsePlanDelta(result.output);

    // Track iteration
    const iterNum = createIteration(sessionId, feedbackText, delta);

    addMessage(
      sessionId,
      'system',
      `Iteration ${iterNum}: ${delta.summary}\nModified: ${delta.modifiedTasks.length} tasks, New: ${delta.newTasks.length} tasks`,
    );

    // Apply delta
    applyPlanDelta(sessionId, delta);
  } else {
    addMessage(sessionId, 'system', 'Build was interrupted — retrying all tasks...');
    console.log('Build was interrupted — retrying all tasks...\n');
  }

  requeueIncompleteTasks(sessionId);

  // Re-run orchestrator on modified/new tasks
  const repoPath = session.repoLocalPath!;
  const sessionBranch = session.workingBranch!;

  // Ensure we're on the session branch before running
  try {
    git(['checkout', sessionBranch], repoPath);
  } catch {
    // May already be on it
  }

  // Clean up stale task branches from previous iterations
  try {
    deleteBranches(`sw/${session.id}-*`, repoPath);
    deleteBranches(`sw/${session.id}/*`, repoPath);
  } catch {
    // Best-effort cleanup
  }

  const activeAgentIds = new Map<string, string>(); // taskId:role -> panelId
  const callbacks: OrchestratorCallbacks = {
    onAgentStart: (taskId, taskTitle, role) => {
      const id = `${role.toLowerCase()}-${++agentCounter}`;
      activeAgentIds.set(`${taskId}:${role}`, id);
      writeEvent(sessionId, { type: 'agent-start', id, role, taskId, title: taskTitle });
    },
    onAgentOutput: (taskId, role, chunk) => {
      const id = activeAgentIds.get(`${taskId}:${role}`) ?? `${role.toLowerCase()}-${agentCounter}`;
      writeEvent(sessionId, { type: 'output', id, chunk });
    },
    onAgentEnd: (taskId, role, success) => {
      const id = activeAgentIds.get(`${taskId}:${role}`) ?? `${role.toLowerCase()}-${agentCounter}`;
      writeEvent(sessionId, { type: 'agent-end', id, success });
    },
    onInputNeeded: async (taskId, role, promptText) => {
      const requestId = `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      writeEvent(sessionId, {
        type: 'input-needed',
        id: requestId,
        taskId,
        role,
        promptText,
        requestId,
      });
      const { waitForResponse } = await import('../session/agent-log.js');
      return waitForResponse(sessionId, requestId);
    },
  };

  // Clean up stale worktrees from previous iterations
  const { join } = await import('path');
  const { homedir } = await import('os');
  const sessionWtDir = join(
    homedir(),
    '.sweteam',
    'worktrees',
    session.id.replace(/[^a-zA-Z0-9_-]/g, '-'),
  );
  try {
    cleanupWorktrees(sessionWtDir, repoPath);
  } catch {
    /* best effort */
  }

  const useParallel = config.execution.max_parallel > 1;
  try {
    if (useParallel) {
      await runParallelOrchestrator(sessionId, repoPath, sessionBranch, callbacks, { images });
    } else {
      await runOrchestrator(sessionId, repoPath, sessionBranch, callbacks, { images });
    }
  } catch (err) {
    writeEvent(sessionId, { type: 'build-complete', id: 'build' });
    try {
      transition(sessionId, 'awaiting_feedback');
    } catch {
      /* already transitioned */
    }
    throw err;
  }
  writeEvent(sessionId, { type: 'build-complete', id: 'build' });

  // Push and create/update PR
  try {
    pushBranch(sessionBranch, repoPath);

    // Create PR if one doesn't exist yet (e.g. initial build had failures)
    const updatedSession = getSession(sessionId);
    if (!updatedSession?.prUrl) {
      try {
        const baseBranch = getDefaultBranch(repoPath);
        const prUrl = createPR(
          session.goal ?? 'sweteam iteration',
          '',
          baseBranch,
          sessionBranch,
          repoPath,
        );
        const prMatch = prUrl.match(/\/pull\/(\d+)/);
        const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;
        db.update(sessions)
          .set({ prUrl, prNumber, updatedAt: new Date() })
          .where(eq(sessions.id, sessionId))
          .run();
        addMessage(sessionId, 'system', `PR created: ${prUrl}`);
      } catch (prErr) {
        const prMsg = prErr instanceof Error ? prErr.message : String(prErr);
        addMessage(sessionId, 'system', `Failed to create PR: ${prMsg}`);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    addMessage(sessionId, 'system', `Failed to push: ${errMsg}`);
  }

  // Transition back (may fail if session was stopped during iteration)
  try {
    transition(sessionId, 'awaiting_feedback');
  } catch {
    // Session may have been stopped — that's fine
  }

  if (!allQueued) {
    const latestIter = getIterationHistory(sessionId);
    const latestNum =
      latestIter.length > 0 ? latestIter[latestIter.length - 1].iterationNumber : null;
    if (latestNum !== null) {
      db.update(iterations)
        .set({ status: 'done' })
        .where(and(eq(iterations.sessionId, sessionId), eq(iterations.iterationNumber, latestNum)))
        .run();
    }
    addMessage(sessionId, 'system', `Iteration complete.`);
  } else {
    addMessage(sessionId, 'system', 'Build retry complete.');
  }
}
