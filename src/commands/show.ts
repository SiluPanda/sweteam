import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  tasks as tasksTable,
  iterations,
} from "../db/schema.js";
import { getSession, getMessages } from "../session/manager.js";
import { relativeTime, formatDuration } from "../utils/time.js";

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

export function buildDetailedView(
  sessionId: string,
): DetailedSessionView | null {
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
  const tasksDone = taskRows.filter((t) => t.status === "done").length;

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
    case "done":
      return "✓";
    case "running":
      return "▶";
    case "reviewing":
      return "⟳";
    case "fixing":
      return "🔧";
    case "failed":
      return "✗";
    case "blocked":
      return "⊘";
    default:
      return "○";
  }
}

export function formatDetailedView(view: DetailedSessionView): string {
  const lines: string[] = [];

  lines.push(
    "┌─────────────────────────────────────────────────────────────┐",
  );
  lines.push(`│  Session: ${view.id}`);
  lines.push(
    "├─────────────────────────────────────────────────────────────┤",
  );

  lines.push(`│  Repo:     ${view.repo}`);
  lines.push(`│  Goal:     ${view.goal}`);
  lines.push(`│  Status:   ${view.status}`);
  lines.push(`│  Branch:   ${view.workingBranch ?? "(none)"}`);
  if (view.prUrl) {
    lines.push(`│  PR:       #${view.prNumber} ${view.prUrl}`);
  }
  lines.push(`│  Plan:     ${view.planReady ? "ready" : "not finalized"}`);

  lines.push("│");
  lines.push(
    `│  Created:  ${view.createdAt.toISOString()} (${relativeTime(view.createdAt)})`,
  );
  lines.push(
    `│  Updated:  ${view.updatedAt.toISOString()} (${relativeTime(view.updatedAt)})`,
  );
  const endTime = view.stoppedAt ?? view.updatedAt;
  lines.push(
    `│  Elapsed:  ${formatDuration(view.createdAt, endTime)}`,
  );
  if (view.stoppedAt) {
    lines.push(`│  Stopped:  ${view.stoppedAt.toISOString()}`);
  }
  if (view.iterationCount > 0) {
    lines.push(`│  Feedback iterations: ${view.iterationCount}`);
  }

  if (view.tasks.length > 0) {
    lines.push("│");
    lines.push(
      "├─ Tasks ─────────────────────────────────────────────────────┤",
    );

    const pct =
      view.tasksTotal > 0
        ? Math.round((view.tasksDone / view.tasksTotal) * 100)
        : 0;
    const filled = Math.floor(pct / 5);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);
    lines.push(
      `│  Progress: [${bar}] ${pct}% (${view.tasksDone}/${view.tasksTotal})`,
    );
    lines.push("│");

    for (const task of view.tasks) {
      const icon = taskIcon(task.status);
      const review = task.reviewVerdict
        ? ` (review: ${task.reviewVerdict}, cycles: ${task.reviewCycles})`
        : "";
      lines.push(
        `│  ${icon} ${task.id}: ${task.title} [${task.status}]${review}`,
      );
    }
  } else {
    lines.push("│");
    lines.push("│  No tasks yet. Finalize the plan and type @build.");
  }

  if (view.recentMessages.length > 0) {
    lines.push("│");
    lines.push(
      "├─ Recent Activity ───────────────────────────────────────────┤",
    );
    for (const msg of view.recentMessages.slice(-5)) {
      const prefix = `[${msg.role}]`;
      const when = msg.createdAt ? relativeTime(msg.createdAt) : "";
      const truncated =
        msg.content.length > 60
          ? msg.content.slice(0, 57) + "..."
          : msg.content;
      lines.push(
        `│  ${when.padEnd(10)} ${prefix.padEnd(10)} ${truncated}`,
      );
    }
  }

  lines.push(
    "└─────────────────────────────────────────────────────────────┘",
  );
  return lines.join("\n");
}

export async function handleShow(sessionId: string): Promise<void> {
  const view = buildDetailedView(sessionId);
  if (!view) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  console.log(formatDetailedView(view));
}
