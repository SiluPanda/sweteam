import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, tasks as tasksTable, messages, iterations } from "../db/schema.js";

export function exportSessionMarkdown(sessionId: string): string {
  const db = getDb();

  // Get session
  const sessionRows = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  if (sessionRows.length === 0) {
    return `Session not found: ${sessionId}`;
  }

  const session = sessionRows[0];

  // Get tasks
  const taskRows = db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .orderBy(tasksTable.order)
    .all();

  // Get iterations
  const iterRows = db
    .select()
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .orderBy(iterations.iterationNumber)
    .all();

  // Build markdown
  const lines: string[] = [];
  lines.push(`# Session Report: ${session.id}`);
  lines.push("");
  lines.push(`**Repository:** ${session.repo}`);
  lines.push(`**Goal:** ${session.goal}`);
  lines.push(`**Status:** ${session.status}`);
  lines.push(`**Created:** ${session.createdAt}`);

  if (session.prUrl) {
    lines.push(`**PR:** [#${session.prNumber}](${session.prUrl})`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // Plan
  if (session.planJson) {
    lines.push("## Plan");
    lines.push("");
    try {
      const plan = JSON.parse(session.planJson);
      if (plan.tasks) {
        for (const t of plan.tasks) {
          lines.push(`- **${t.id}:** ${t.title}`);
          if (t.description) {
            lines.push(`  ${t.description}`);
          }
        }
      }
    } catch {
      lines.push("```");
      lines.push(session.planJson);
      lines.push("```");
    }
    lines.push("");
  }

  // Tasks
  if (taskRows.length > 0) {
    lines.push("## Tasks");
    lines.push("");
    lines.push("| ID | Title | Status | Review | Cycles |");
    lines.push("|---|---|---|---|---|");

    for (const task of taskRows) {
      lines.push(
        `| ${task.id} | ${task.title} | ${task.status} | ${task.reviewVerdict ?? "-"} | ${task.reviewCycles ?? 0} |`,
      );
    }
    lines.push("");

    // Diffs
    const tasksWithDiffs = taskRows.filter((t) => t.diffPatch);
    if (tasksWithDiffs.length > 0) {
      lines.push("## Diffs");
      lines.push("");
      for (const task of tasksWithDiffs) {
        lines.push(`### ${task.id}: ${task.title}`);
        lines.push("");
        lines.push("```diff");
        lines.push(task.diffPatch!.slice(0, 2000));
        lines.push("```");
        lines.push("");
      }
    }
  }

  // Iterations
  if (iterRows.length > 0) {
    lines.push("## Iterations");
    lines.push("");
    for (const iter of iterRows) {
      lines.push(`### Iteration ${iter.iterationNumber}`);
      lines.push("");
      lines.push(`**Feedback:** ${iter.feedback}`);
      lines.push(`**Status:** ${iter.status}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
