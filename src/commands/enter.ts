import { getSession, getMessages } from "../session/manager.js";
import { tasks } from "../db/schema.js";
import { getDb } from "../db/client.js";
import { eq } from "drizzle-orm";

export interface SessionSummary {
  id: string;
  repo: string;
  goal: string;
  status: string;
  prUrl: string | null;
  tasksDone: number;
  tasksTotal: number;
  lastActivity: Date | null;
  recentMessages: Array<{
    role: string;
    content: string;
    createdAt: Date | null;
  }>;
}

export function buildSessionSummary(sessionId: string): SessionSummary | null {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const db = getDb();
  const taskRows = db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.sessionId, sessionId))
    .all();

  const tasksTotal = taskRows.length;
  const tasksDone = taskRows.filter((t) => t.status === "done").length;

  const recentMessages = getMessages(sessionId, 10);

  const lastActivity =
    recentMessages.length > 0
      ? recentMessages[recentMessages.length - 1].createdAt
      : session.updatedAt;

  return {
    id: session.id,
    repo: session.repo,
    goal: session.goal,
    status: session.status,
    prUrl: session.prUrl,
    tasksDone,
    tasksTotal,
    lastActivity,
    recentMessages: recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

export function formatSummary(summary: SessionSummary): string {
  const lines: string[] = [];
  lines.push(`Session: ${summary.id}`);
  lines.push(`  Repo:   ${summary.repo}`);
  lines.push(`  Goal:   ${summary.goal}`);
  lines.push(`  Status: ${summary.status}`);
  if (summary.prUrl) {
    lines.push(`  PR:     ${summary.prUrl}`);
  }
  if (summary.tasksTotal > 0) {
    lines.push(`  Tasks:  ${summary.tasksDone}/${summary.tasksTotal} done`);
  }
  if (summary.lastActivity) {
    lines.push(`  Last activity: ${summary.lastActivity.toISOString()}`);
  }

  if (summary.recentMessages.length > 0) {
    lines.push("");
    lines.push("Recent messages:");
    for (const msg of summary.recentMessages) {
      const prefix = `[${msg.role}]`;
      const truncated =
        msg.content.length > 80
          ? msg.content.slice(0, 77) + "..."
          : msg.content;
      lines.push(`  ${prefix.padEnd(10)} ${truncated}`);
    }
  }

  return lines.join("\n");
}

export async function handleEnter(sessionId: string): Promise<void> {
  const summary = buildSessionSummary(sessionId);
  if (!summary) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  console.log(formatSummary(summary));

  // Interactive session loop will be wired in Task 36 (chat.ts)
}
