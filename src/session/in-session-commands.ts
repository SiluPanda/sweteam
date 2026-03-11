import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions, tasks as tasksTable } from '../db/schema.js';
import { git, getDefaultBranch } from '../git/git.js';
import { displayTaskId } from '../orchestrator/orchestrator.js';
import { getPlannerState } from './interactive.js';
import { hasActiveProcesses } from '../lifecycle.js';

// Human-readable labels for session statuses
const STATE_LABELS: Record<string, string> = {
  planning: 'Planning',
  building: 'Building',
  awaiting_feedback: 'Awaiting feedback',
  iterating: 'Iterating',
  stopped: 'Stopped',
};

/** Format a duration in ms to a human-readable string like "2m 30s" or "31m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

// @status — Task progress with summary
export function getStatusDisplay(sessionId: string): string {
  const db = getDb();

  // Prepend session state and goal
  const sessionRows = db
    .select({ status: sessions.status, goal: sessions.goal, planJson: sessions.planJson })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  const headerLines: string[] = [];
  let hasPlan = false;
  if (sessionRows.length > 0) {
    const s = sessionRows[0];
    const label = STATE_LABELS[s.status as string] ?? s.status;
    headerLines.push(`Session: ${label}`);
    if (s.goal) {
      headerLines.push(`Goal:    ${s.goal}`);
    }
    headerLines.push('');
    hasPlan = s.planJson != null;
  }

  const taskRows = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(tasksTable.order)
    .all();

  if (taskRows.length === 0) {
    if (hasPlan) {
      return headerLines.join('\n') + 'Plan ready. Type @build to start autonomous coding.';
    }

    // Enrich status during active planning
    const plannerState = getPlannerState(sessionId);
    if (plannerState?.inProgress) {
      const elapsed = Date.now() - (plannerState.startedAt ?? Date.now());
      const elapsedStr = formatDuration(elapsed);
      const processAlive = hasActiveProcesses(sessionId);

      const lines = [...headerLines];
      lines.push(`Planner: running for ${elapsedStr}`);

      if (plannerState.lastActivityAt) {
        const sinceActivity = Date.now() - plannerState.lastActivityAt;
        if (sinceActivity > 60_000) {
          lines.push(`  ⚠ No output for ${formatDuration(sinceActivity)}`);
          if (!processAlive) {
            lines.push(
              '  ⚠ Planner process may have crashed. Try @cancel then resend your message.',
            );
          } else {
            lines.push('  Process is alive — agent may be thinking.');
          }
        } else {
          lines.push('  Receiving output...');
        }
      }

      lines.push('');
      lines.push('Hint: @cancel to abort planning, or wait for it to finish.');
      return lines.join('\n');
    }

    return headerLines.join('\n') + 'No plan yet. Describe your goal to start planning.';
  }

  const counts = {
    queued: 0,
    running: 0,
    reviewing: 0,
    fixing: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  };

  const lines: string[] = [...headerLines, 'Task Status:'];

  for (const task of taskRows) {
    const status = task.status as keyof typeof counts;
    if (status in counts) counts[status]++;

    let icon: string;
    switch (task.status) {
      case 'done':
        icon = '✓';
        break;
      case 'running':
        icon = '▶';
        break;
      case 'reviewing':
        icon = '⟳';
        break;
      case 'fixing':
        icon = '🔧';
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
    lines.push(`  ${icon} ${displayTaskId(task.id)}  ${task.title}  [${task.status}]`);
  }

  const total = taskRows.length;
  const doneCount = counts.done;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));

  const active = counts.running + counts.reviewing + counts.fixing;

  lines.push('');
  lines.push(`Progress: [${bar}] ${pct}% (${doneCount}/${total})`);
  lines.push(
    `  Queued: ${counts.queued} | Running: ${active} | Done: ${counts.done} | Failed: ${counts.failed} | Blocked: ${counts.blocked}`,
  );

  return lines.join('\n');
}

// @plan — Display current plan
export function getPlanDisplay(sessionId: string): string {
  const db = getDb();
  const rows = db
    .select({ planJson: sessions.planJson })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  if (rows.length === 0 || !rows[0].planJson) {
    return 'No plan finalized yet.';
  }

  try {
    const plan = JSON.parse(rows[0].planJson);
    if (plan.tasks && Array.isArray(plan.tasks)) {
      const lines = ['Current Plan:', ''];
      for (const task of plan.tasks) {
        lines.push(`  ${task.id}: ${task.title}`);
        if (task.description) {
          lines.push(`    ${task.description}`);
        }
      }
      return lines.join('\n');
    }
    return rows[0].planJson;
  } catch {
    return rows[0].planJson;
  }
}

// @diff — Cumulative diff
export function getDiffDisplay(sessionId: string): string {
  const db = getDb();
  const rows = db
    .select({
      workingBranch: sessions.workingBranch,
      repoLocalPath: sessions.repoLocalPath,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  if (rows.length === 0 || !rows[0].repoLocalPath || !rows[0].workingBranch) {
    return 'No diff available.';
  }

  try {
    const defaultBranch = getDefaultBranch(rows[0].repoLocalPath);
    const diff = git(
      ['diff', `${defaultBranch}...${rows[0].workingBranch}`],
      rows[0].repoLocalPath,
    );
    return diff || 'No changes yet.';
  } catch {
    return 'Could not generate diff.';
  }
}

// @pr — PR URL
export function getPrDisplay(sessionId: string): string {
  const db = getDb();
  const rows = db
    .select({ prUrl: sessions.prUrl, prNumber: sessions.prNumber })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  if (rows.length === 0 || !rows[0].prUrl) {
    return 'No PR created yet.';
  }

  return `PR #${rows[0].prNumber}: ${rows[0].prUrl}`;
}

// @tasks — Detailed task list
export function getTasksDisplay(sessionId: string): string {
  const db = getDb();
  const taskRows = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      reviewVerdict: tasksTable.reviewVerdict,
      reviewCycles: tasksTable.reviewCycles,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(tasksTable.order)
    .all();

  if (taskRows.length === 0) {
    return 'No tasks defined.';
  }

  const lines = ['Tasks:'];
  for (const task of taskRows) {
    const review = task.reviewVerdict
      ? ` (review: ${task.reviewVerdict}, cycles: ${task.reviewCycles})`
      : '';
    lines.push(`  ${displayTaskId(task.id)}: ${task.title} [${task.status}]${review}`);
  }

  return lines.join('\n');
}

// @help
export function getHelpDisplay(sessionId?: string): string {
  let status: string | null = null;

  if (sessionId) {
    const db = getDb();
    const rows = db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .all();
    if (rows.length > 0) {
      status = rows[0].status as string;
    }
  }

  const na = ' (not applicable now)';

  const lines: string[] = [];

  if (status) {
    lines.push(`Session state: ${STATE_LABELS[status] ?? status}`);
    lines.push('');
  }

  lines.push('Session commands (@ prefix):');
  lines.push('');

  // @build only relevant during planning
  const buildNote = status && status !== 'planning' ? na : '';
  lines.push(`  @build      Finalize plan and start autonomous coding${buildNote}`);

  lines.push('  @status     Show current task progress dashboard');
  lines.push('  @plan       Re-display the current plan');

  // @feedback works during planning (refines the plan) and awaiting_feedback (iterates on built code)
  const fbNote =
    status && !['planning', 'awaiting_feedback'].includes(status) ? na : '';
  lines.push(
    `  @feedback   Give feedback (refines plan during planning, iterates after build)${fbNote}`,
  );

  lines.push('  @watch      Re-attach to live agent output');
  lines.push('  @diff       Show the current cumulative diff');
  lines.push('  @pr         Show the PR link');
  lines.push('  @tasks      List all tasks and their statuses');
  lines.push('  @ask        Ask the architect about the development process');
  // @cancel only relevant during planning
  const cancelNote = status && status !== 'planning' ? na : '';
  lines.push(`  @cancel     Cancel the current planner run (session stays active)${cancelNote}`);
  lines.push('  @stop       Stop this session');
  lines.push('  @help       Show this help message');
  lines.push('');
  lines.push('  Escape      Leave session (back to sweteam>)');
  lines.push('');
  lines.push('Any other text is sent to the planner.');

  return lines.join('\n');
}
