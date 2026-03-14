import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tasks as tasksTable, iterations } from '../db/schema.js';
import { getSession, getMessages } from '../session/manager.js';
import { relativeTime, formatDuration } from '../utils/time.js';
import { displayTaskId } from '../orchestrator/orchestrator.js';
import {
  c,
  border,
  box,
  icons,
  progressBar,
  doubleDivider,
  rPad,
  vLen,
} from '../ui/theme.js';

export interface DetailedSessionView {
  id: string;
  repo: string;
  goal: string;
  status: string;
  workingBranch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  planReady: boolean;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    reviewVerdict: string | null;
    reviewCycles: number | null;
    order: number;
  }>;
  tasksDone: number;
  tasksTotal: number;
  iterationCount: number;
  recentMessages: Array<{
    role: string;
    content: string;
    createdAt: Date | null;
  }>;
}

export function buildDetailedView(sessionId: string): DetailedSessionView | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const db = getDb();

  const taskRows = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      reviewVerdict: tasksTable.reviewVerdict,
      reviewCycles: tasksTable.reviewCycles,
      order: tasksTable.order,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(tasksTable.order)
    .all();

  const iterRows = db
    .select({ id: iterations.id })
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .all();

  const recentMessages = getMessages(sessionId, 10);

  const tasksTotal = taskRows.length;
  const tasksDone = taskRows.filter((t) => t.status === 'done').length;

  return {
    id: session.id,
    repo: session.repo,
    goal: session.goal,
    status: session.status,
    workingBranch: session.workingBranch,
    prUrl: session.prUrl,
    prNumber: session.prNumber,
    planReady: session.planJson != null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    stoppedAt: session.stoppedAt ?? null,
    tasks: taskRows,
    tasksDone,
    tasksTotal,
    iterationCount: iterRows.length,
    recentMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

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

const BOX_WIDTH = 62;

export function formatDetailedView(view: DetailedSessionView): string {
  const lines: string[] = [];
  const bdr = border.primary;
  const innerW = BOX_WIDTH - 2; // inside the vertical bars

  const row = (content: string) => bdr(box.vertical) + '  ' + rPad(content, innerW - 2) + bdr(box.vertical);
  const emptyRow = () => bdr(box.vertical) + ' '.repeat(innerW) + bdr(box.vertical);
  const teeRow = (content: string) =>
    bdr(box.teeLeft) + rPad(content, innerW) + bdr(box.teeRight);

  // Top border
  lines.push(bdr(box.topLeft + box.horizontal.repeat(innerW) + box.topRight));

  // Session header
  lines.push(row(c.subtle('Session: ') + c.info(view.id)));

  // Divider
  lines.push(bdr(box.teeLeft + box.horizontal.repeat(innerW) + box.teeRight));

  // Session details
  lines.push(row(c.subtle('Repo:     ') + c.text(view.repo)));
  lines.push(row(c.subtle('Goal:     ') + c.text(view.goal)));
  lines.push(row(c.subtle('Status:   ') + c.text(view.status)));
  lines.push(row(c.subtle('Branch:   ') + c.text(view.workingBranch ?? '(none)')));
  if (view.prUrl) {
    lines.push(row(c.subtle('PR:       ') + c.text(`#${view.prNumber} ${view.prUrl}`)));
  }
  lines.push(row(c.subtle('Plan:     ') + c.text(view.planReady ? 'ready' : 'not finalized')));

  lines.push(emptyRow());
  lines.push(row(c.subtle('Created:  ') + c.text(`${view.createdAt.toISOString()} (${relativeTime(view.createdAt)})`)));
  lines.push(row(c.subtle('Updated:  ') + c.text(`${view.updatedAt.toISOString()} (${relativeTime(view.updatedAt)})`)));
  const endTime = view.stoppedAt ?? view.updatedAt;
  lines.push(row(c.subtle('Elapsed:  ') + c.text(formatDuration(view.createdAt, endTime))));
  if (view.stoppedAt) {
    lines.push(row(c.subtle('Stopped:  ') + c.text(view.stoppedAt.toISOString())));
  }
  if (view.iterationCount > 0) {
    lines.push(row(c.subtle('Feedback iterations: ') + c.text(String(view.iterationCount))));
  }

  // Tasks section
  if (view.tasks.length > 0) {
    lines.push(emptyRow());
    lines.push(teeRow(doubleDivider(innerW, 'Tasks')));

    // Progress bar
    lines.push(row(c.subtle('Progress: ') + progressBar(view.tasksDone, view.tasksTotal, 20)));
    lines.push(emptyRow());

    // Task list with tree connectors
    for (let i = 0; i < view.tasks.length; i++) {
      const task = view.tasks[i];
      const icon = taskIcon(task.status);
      const connector = i < view.tasks.length - 1
        ? c.dim(box.treeBranch)
        : c.dim(box.treeLast);
      const review = task.reviewVerdict
        ? c.muted(` (review: ${task.reviewVerdict}, cycles: ${task.reviewCycles})`)
        : '';
      lines.push(row(
        `${connector} ${icon} ${c.text(displayTaskId(task.id))}: ${c.text(task.title)} ${c.dim(`[${task.status}]`)}${review}`,
      ));
    }
  } else {
    lines.push(emptyRow());
    lines.push(row(c.muted('No tasks yet. Finalize the plan and type @build.')));
  }

  // Recent activity section
  if (view.recentMessages.length > 0) {
    lines.push(emptyRow());
    lines.push(teeRow(doubleDivider(innerW, 'Recent Activity')));
    for (const msg of view.recentMessages.slice(-5)) {
      const when = msg.createdAt ? c.muted(relativeTime(msg.createdAt).padEnd(10)) : c.muted(' '.repeat(10));
      const prefix = c.info(`[${msg.role}]`.padEnd(10));
      const truncated = msg.content.length > 60 ? msg.content.slice(0, 57) + '...' : msg.content;
      lines.push(row(`${when} ${prefix} ${c.text(truncated)}`));
    }
  }

  // Bottom border
  lines.push(bdr(box.bottomLeft + box.horizontal.repeat(innerW) + box.bottomRight));
  return lines.join('\n');
}

export async function handleShow(sessionId: string): Promise<void> {
  const view = buildDetailedView(sessionId);
  if (!view) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  console.log(formatDetailedView(view));
}
