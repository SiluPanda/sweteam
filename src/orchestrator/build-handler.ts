import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions, tasks as tasksTable } from '../db/schema.js';
import { transition } from '../session/state-machine.js';
import { addMessage, getSession } from '../session/manager.js';
import { parsePlan } from '../planner/plan-parser.js';
import { loadConfig } from '../config/loader.js';
import {
  insertTasksFromPlan,
  getTasksForSession,
  runOrchestrator,
  displayTaskId,
  type OrchestratorCallbacks,
} from './orchestrator.js';
import {
  git,
  pushBranch,
  createPR,
  getDefaultBranch,
  deleteBranches,
  cleanupWorktrees,
} from '../git/git.js';
import { runParallelOrchestrator } from './parallel-runner.js';
import { clearLog, writeEvent, waitForResponse } from '../session/agent-log.js';

export function generatePrBody(
  goal: string,
  taskResults: {
    completed: string[];
    failed: string[];
    blocked: string[];
  },
  allTasks: Array<{ id: string; title: string; status: string }>,
): string {
  const lines: string[] = [];
  lines.push(`## Goal`);
  lines.push(goal);
  lines.push('');
  lines.push('## Tasks');

  for (const task of allTasks) {
    let icon: string;
    switch (task.status) {
      case 'done':
        icon = '✓';
        break;
      case 'failed':
        icon = '✗';
        break;
      case 'blocked':
        icon = '⊘';
        break;
      default:
        icon = '○';
    }
    lines.push(`- ${icon} ${displayTaskId(task.id)}: ${task.title}`);
  }

  lines.push('');
  lines.push('## Summary');
  lines.push(
    `${taskResults.completed.length} completed, ${taskResults.failed.length} failed, ${taskResults.blocked.length} blocked`,
  );

  if (taskResults.failed.length > 0) {
    lines.push('');
    lines.push('## Escalated Tasks');
    for (const id of taskResults.failed) {
      const task = allTasks.find((t) => t.id === id);
      lines.push(`- ${displayTaskId(id)}: ${task?.title ?? 'unknown'}`);
    }
  }

  return lines.join('\n');
}

export function formatCompletionReport(
  taskResults: {
    completed: string[];
    failed: string[];
    blocked: string[];
  },
  allTasks: Array<{ id: string; title: string; status: string }>,
  prUrl?: string,
): string {
  const lines: string[] = [];
  const hasFailures = taskResults.failed.length > 0 || taskResults.blocked.length > 0;

  lines.push(hasFailures ? 'Build finished with failures.' : 'Build complete.');
  lines.push('');

  for (const task of allTasks) {
    let prefix: string;
    switch (task.status) {
      case 'done':
        prefix = '  ✓';
        break;
      case 'failed':
        prefix = '  ⚠';
        break;
      case 'blocked':
        prefix = '  ⊘';
        break;
      default:
        prefix = '  ○';
    }
    lines.push(`${prefix} ${displayTaskId(task.id)}  ${task.title}`);
  }

  lines.push('');
  if (prUrl) {
    lines.push(`PR: ${prUrl}`);
  }
  lines.push('');
  if (hasFailures) {
    lines.push(`${taskResults.failed.length} failed, ${taskResults.blocked.length} blocked.`);
    lines.push('Type @feedback with guidance to retry failed tasks, or @build to restart.');
  } else {
    lines.push('Review the PR and type @feedback with any changes needed.');
  }

  return lines.join('\n');
}

export async function handleBuild(sessionId: string, planOutput: string, images?: string[]): Promise<void> {
  const db = getDb();

  // Parse the plan
  const plan = parsePlan(planOutput);

  if (plan.tasks.length === 0) {
    const msg = 'Could not parse tasks from the plan. Please refine the plan and try @build again.';
    addMessage(sessionId, 'system', msg);
    console.log(msg);
    return;
  }

  // Save plan JSON to session
  db.update(sessions)
    .set({
      planJson: JSON.stringify(plan),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId))
    .run();

  // Transition to building
  transition(sessionId, 'building');

  // Clean up all tasks from previous builds — the entire plan is re-inserted
  db.delete(tasksTable).where(eq(tasksTable.sessionId, sessionId)).run();

  // Insert tasks into DB
  insertTasksFromPlan(sessionId, plan.tasks);

  addMessage(
    sessionId,
    'system',
    `Plan finalized with ${plan.tasks.length} tasks. Starting build...`,
  );

  // Print task list so the user sees what will be built
  console.log(`Found ${plan.tasks.length} tasks:\n`);
  for (const t of plan.tasks) {
    const deps = t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(', ')})` : '';
    console.log(`  ${t.id}  ${t.title}${deps}`);
  }
  console.log();

  // Run the orchestrator
  const session = getSession(sessionId)!;
  const repoPath = session.repoLocalPath!;
  const sessionBranch = session.workingBranch!;

  // Ensure we're on the session branch before cleanup (prevents it from being deleted)
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  if (currentBranch !== sessionBranch) {
    try {
      git(['checkout', sessionBranch], repoPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot switch to session branch '${sessionBranch}': ${msg}`, {
        cause: err,
      });
    }
  }

  // Clean up stale task branches from previous build attempts.
  // Old naming used "/" (sw/s_ID/taskN-...) which conflicts with session branch sw/s_ID.
  // New naming uses "-" (sw/s_ID-taskN-...) but leftovers from either scheme must go.
  // The session branch itself is safe because it's currently checked out.
  try {
    deleteBranches(`sw/${sessionId}-*`, repoPath); // new-style task branches
    deleteBranches(`sw/${sessionId}/*`, repoPath); // old-style task branches (ref conflict)
  } catch {
    // Best-effort cleanup
  }

  // Clear log file so watchers from other processes start fresh
  clearLog(sessionId);

  let agentCounter = 0;
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
      return waitForResponse(sessionId, requestId);
    },
  };

  // Clean up stale worktrees from previous builds
  const { join } = await import('path');
  const { homedir } = await import('os');
  const sessionWtDir = join(
    homedir(),
    '.sweteam',
    'worktrees',
    sessionId.replace(/[^a-zA-Z0-9_-]/g, '-'),
  );
  try {
    cleanupWorktrees(sessionWtDir, repoPath);
  } catch {
    /* best effort */
  }

  const buildConfig = loadConfig();
  const useParallel = buildConfig.execution.max_parallel > 1;
  let result: Awaited<ReturnType<typeof runOrchestrator>>;
  try {
    result = useParallel
      ? await runParallelOrchestrator(sessionId, repoPath, sessionBranch, callbacks, { images })
      : await runOrchestrator(sessionId, repoPath, sessionBranch, callbacks, { images });
  } catch (err) {
    writeEvent(sessionId, { type: 'build-complete', id: 'build' });
    // Build failed before completing — go back to planning so user can @build to retry
    try {
      transition(sessionId, 'planning');
    } catch {
      /* already transitioned */
    }
    throw err;
  }
  writeEvent(sessionId, { type: 'build-complete', id: 'build' });

  // Get final task states
  const allTasks = getTasksForSession(sessionId).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
  }));

  // Only create PR when all tasks succeeded — don't publish partial/broken work
  let prUrl: string | undefined;
  const allSucceeded =
    result.failed.length === 0 && result.blocked.length === 0 && result.completed.length > 0;
  if (allSucceeded) {
    try {
      pushBranch(sessionBranch, repoPath);

      const prBody = generatePrBody(session.goal, result, allTasks);
      const baseBranch = getDefaultBranch(repoPath);
      prUrl = createPR(session.goal, prBody, baseBranch, sessionBranch, repoPath);

      // Parse PR URL for number
      const prMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;

      db.update(sessions)
        .set({
          prUrl,
          prNumber,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId))
        .run();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addMessage(sessionId, 'system', `Failed to create PR: ${errMsg}`);
    }
  }

  // Transition based on outcome: if all tasks failed/blocked with zero completed,
  // go back to planning so user can @build to retry; otherwise await feedback
  const allFailed = result.completed.length === 0 && (result.failed.length > 0 || result.blocked.length > 0);
  if (allFailed) {
    transition(sessionId, 'planning');
    const failMsg = 'Build failed — all tasks failed or were blocked. Refine the plan and try @build again.';
    addMessage(sessionId, 'system', failMsg);
    console.log(failMsg);
  } else {
    transition(sessionId, 'awaiting_feedback');
  }

  // Print completion report
  const report = formatCompletionReport(result, allTasks, prUrl);
  addMessage(sessionId, 'system', report);
  console.log(report);
}
