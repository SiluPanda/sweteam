import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions, tasks as tasksTable } from '../db/schema.js';
import { git, getDefaultBranch } from '../git/git.js';
import { displayTaskId } from '../orchestrator/orchestrator.js';
import { getPlannerState } from './interactive.js';
import { hasActiveProcesses } from '../lifecycle.js';
import { c, box, icons, progressBar, statusBadge, divider } from '../ui/theme.js';

/** Format a duration in ms to a human-readable string like "2m 30s" or "31m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** Return a themed task icon based on task status. */
function taskIcon(status: string): string {
  switch (status) {
    case 'done':
      return c.success(icons.taskDone);
    case 'running':
      return c.info(icons.taskRunning);
    case 'reviewing':
      return c.warning(icons.taskReviewing);
    case 'fixing':
      return c.orange(icons.taskFixing);
    case 'failed':
      return c.error(icons.taskFailed);
    case 'blocked':
      return c.muted(icons.taskBlocked);
    default:
      return c.dim(icons.taskQueued);
  }
}

/** Return a colored status text for brackets display. */
function coloredStatus(status: string): string {
  switch (status) {
    case 'done':
      return c.success(status);
    case 'running':
      return c.info(status);
    case 'reviewing':
      return c.warning(status);
    case 'fixing':
      return c.orange(status);
    case 'failed':
      return c.error(status);
    case 'blocked':
      return c.muted(status);
    default:
      return c.dim(status);
  }
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
    headerLines.push(c.brightBold('Session: ') + statusBadge(s.status as string));
    if (s.goal) {
      headerLines.push(c.subtle('Goal:') + ' ' + c.text(s.goal));
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
      return headerLines.join('\n') + c.info('Plan ready.') + ' ' + c.text('Type ') + c.cyan('@build') + c.text(' to start autonomous coding.');
    }

    // Enrich status during active planning
    const plannerState = getPlannerState(sessionId);
    if (plannerState?.inProgress) {
      const elapsed = Date.now() - (plannerState.startedAt ?? Date.now());
      const elapsedStr = formatDuration(elapsed);
      const processAlive = hasActiveProcesses(sessionId);

      const lines = [...headerLines];
      lines.push(c.info('Planner:') + ' ' + c.text(`running for ${elapsedStr}`));

      if (plannerState.lastActivityAt) {
        const sinceActivity = Date.now() - plannerState.lastActivityAt;
        if (sinceActivity > 60_000) {
          lines.push(`  ${c.warning(icons.warning)} ${c.warning(`No output for ${formatDuration(sinceActivity)}`)}`);
          if (!processAlive) {
            lines.push(
              `  ${c.warning(icons.warning)} ${c.error('Planner process may have crashed.')} ${c.text('Try')} ${c.cyan('@cancel')} ${c.text('then resend your message.')}`,
            );
          } else {
            lines.push(`  ${c.text('Process is alive — agent may be thinking.')}`);
          }
        } else {
          lines.push(`  ${c.success('Receiving output...')}`);
        }
      }

      lines.push('');
      lines.push(c.dim('Hint:') + ' ' + c.cyan('@cancel') + c.text(' to abort planning, or wait for it to finish.'));
      return lines.join('\n');
    }

    return headerLines.join('\n') + c.text('No plan yet. Describe your goal to start planning.');
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

  const lines: string[] = [...headerLines, c.primaryBold('Task Status:')];

  for (let i = 0; i < taskRows.length; i++) {
    const task = taskRows[i];
    const status = task.status as keyof typeof counts;
    if (status in counts) counts[status]++;

    const isLast = i === taskRows.length - 1;
    const connector = isLast ? box.treeLast : box.treeBranch;
    const icon = taskIcon(task.status as string);
    lines.push(`  ${c.dim(connector)} ${icon} ${c.cyan(displayTaskId(task.id))}  ${c.text(task.title)}  [${coloredStatus(task.status as string)}]`);
  }

  const total = taskRows.length;
  const doneCount = counts.done;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const bar = progressBar(doneCount, total, 20);

  const active = counts.running + counts.reviewing + counts.fixing;

  lines.push('');
  lines.push(`${c.subtle('Progress:')} ${bar} ${c.brightBold(`${pct}%`)}`);
  lines.push(
    `  ${c.dim('Queued:')} ${c.text(String(counts.queued))} ${c.dim('|')} ${c.info('Running:')} ${c.text(String(active))} ${c.dim('|')} ${c.success('Done:')} ${c.text(String(counts.done))} ${c.dim('|')} ${c.error('Failed:')} ${c.text(String(counts.failed))} ${c.dim('|')} ${c.muted('Blocked:')} ${c.text(String(counts.blocked))}`,
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
    return c.dim('No plan finalized yet.');
  }

  try {
    const plan = JSON.parse(rows[0].planJson);
    if (plan.tasks && Array.isArray(plan.tasks)) {
      const lines = [c.primaryBold('Current Plan:'), ''];
      for (const task of plan.tasks) {
        lines.push(`  ${c.cyan(task.id)}: ${c.text(task.title)}`);
        if (task.description) {
          lines.push(`    ${c.subtle(task.description)}`);
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

  const prLabel = rows[0].prNumber ? `PR #${rows[0].prNumber}:` : 'PR:';
  return `${prLabel} ${rows[0].prUrl}`;
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
    return c.dim('No tasks defined.');
  }

  const lines = [c.primaryBold('Tasks:')];
  for (let i = 0; i < taskRows.length; i++) {
    const task = taskRows[i];
    const isLast = i === taskRows.length - 1;
    const connector = isLast ? box.treeLast : box.treeBranch;
    const icon = taskIcon(task.status as string);
    const review = task.reviewVerdict
      ? c.subtle(` (review: ${task.reviewVerdict}, cycles: ${task.reviewCycles})`)
      : '';
    lines.push(`  ${c.dim(connector)} ${icon} ${c.cyan(displayTaskId(task.id))}: ${c.text(task.title)} [${coloredStatus(task.status as string)}]${review}`);
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

  const na = c.dim(' (not applicable now)');

  const lines: string[] = [];

  if (status) {
    lines.push(c.subtle('Session state:') + ' ' + statusBadge(status));
    lines.push('');
  }

  lines.push(c.primaryBold('Session commands') + c.subtle(' (@ prefix):'));
  lines.push('');

  // @build only relevant during planning
  const buildNote = status && status !== 'planning' ? na : '';
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@build')}      ${c.subtle('Finalize plan and start autonomous coding')}${buildNote}`);

  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@status')}     ${c.subtle('Show current task progress dashboard')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@plan')}       ${c.subtle('Re-display the current plan')}`);

  // @feedback works during planning (refines the plan) and awaiting_feedback (iterates on built code)
  const fbNote =
    status && !['planning', 'awaiting_feedback'].includes(status) ? na : '';
  lines.push(
    `  ${c.dim(icons.pointer)} ${c.cyan('@feedback')}   ${c.subtle('Give feedback (refines plan during planning, iterates after build)')}${fbNote}`,
  );

  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@watch')}      ${c.subtle('Re-attach to live agent output')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@diff')}       ${c.subtle('Show the current cumulative diff')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@pr')}         ${c.subtle('Show the PR link')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@tasks')}      ${c.subtle('List all tasks and their statuses')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@ask')}        ${c.subtle('Ask the architect about the development process')}`);
  // @cancel only relevant during planning
  const cancelNote = status && status !== 'planning' ? na : '';
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@cancel')}     ${c.subtle('Cancel the current planner run (session stays active)')}${cancelNote}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@image')}      ${c.subtle('Attach image file(s) to pass to the underlying CLI agent')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@images')}     ${c.subtle('List attached images (@images clear to remove all)')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@stop')}       ${c.subtle('Stop this session')}`);
  lines.push(`  ${c.dim(icons.pointer)} ${c.cyan('@help')}       ${c.subtle('Show this help message')}`);

  lines.push('');
  lines.push(divider(50));
  lines.push('');
  lines.push(`  ${c.muted('Escape')}      ${c.dim('Leave session (back to sweteam>)')}`);
  lines.push('');
  lines.push(c.dim('Any other text is sent to the planner.'));

  return lines.join('\n');
}
