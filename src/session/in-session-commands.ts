import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, tasks as tasksTable } from "../db/schema.js";
import { git } from "../git/git.js";
import { displayTaskId } from "../orchestrator/orchestrator.js";

// @status — Task progress with summary
export function getStatusDisplay(sessionId: string): string {
  const db = getDb();
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
    return "No tasks yet. Finalize the plan and type @build.";
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

  const lines: string[] = ["Task Status:"];

  for (const task of taskRows) {
    const status = task.status as keyof typeof counts;
    if (status in counts) counts[status]++;

    let icon: string;
    switch (task.status) {
      case "done":
        icon = "✓";
        break;
      case "running":
        icon = "▶";
        break;
      case "reviewing":
        icon = "⟳";
        break;
      case "fixing":
        icon = "🔧";
        break;
      case "failed":
        icon = "✗";
        break;
      case "blocked":
        icon = "⊘";
        break;
      default:
        icon = "○";
    }
    lines.push(`  ${icon} ${displayTaskId(task.id)}  ${task.title}  [${task.status}]`);
  }

  const total = taskRows.length;
  const doneCount = counts.done;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));

  lines.push("");
  lines.push(`Progress: [${bar}] ${pct}% (${doneCount}/${total})`);
  lines.push(
    `  Queued: ${counts.queued} | Running: ${counts.running} | Done: ${counts.done} | Failed: ${counts.failed} | Blocked: ${counts.blocked}`,
  );

  return lines.join("\n");
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
    return "No plan finalized yet.";
  }

  try {
    const plan = JSON.parse(rows[0].planJson);
    if (plan.tasks && Array.isArray(plan.tasks)) {
      const lines = ["Current Plan:", ""];
      for (const task of plan.tasks) {
        lines.push(`  ${task.id}: ${task.title}`);
        if (task.description) {
          lines.push(`    ${task.description}`);
        }
      }
      return lines.join("\n");
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
    return "No diff available.";
  }

  try {
    const diff = git(
      `diff main...${rows[0].workingBranch}`,
      rows[0].repoLocalPath,
    );
    return diff || "No changes yet.";
  } catch {
    return "Could not generate diff.";
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
    return "No PR created yet.";
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
    return "No tasks defined.";
  }

  const lines = ["Tasks:"];
  for (const task of taskRows) {
    const review = task.reviewVerdict
      ? ` (review: ${task.reviewVerdict}, cycles: ${task.reviewCycles})`
      : "";
    lines.push(`  ${displayTaskId(task.id)}: ${task.title} [${task.status}]${review}`);
  }

  return lines.join("\n");
}

// @help
export function getHelpDisplay(): string {
  return [
    "Available in-session commands:",
    "",
    "  @build      Finalize plan and start autonomous coding",
    "  @status     Show current task progress dashboard",
    "  @plan       Re-display the current plan",
    "  @feedback   Give feedback on completed work (triggers new iteration)",
    "  @diff       Show the current cumulative diff",
    "  @pr         Show the PR link",
    "  @tasks      List all tasks and their statuses",
    "  @stop       Stop this session",
    "  @help       Show this help message",
  ].join("\n");
}
