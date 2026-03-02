import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, tasks as tasksTable } from "../db/schema.js";

export interface CostSummary {
  sessionId: string;
  totalInvocations: number;
  totalDurationMs: number;
  taskBreakdown: Array<{
    taskId: string;
    title: string;
    durationMs: number;
    reviewCycles: number;
  }>;
}

export function getSessionCost(sessionId: string): CostSummary {
  const db = getDb();

  const taskRows = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      reviewCycles: tasksTable.reviewCycles,
      agentOutput: tasksTable.agentOutput,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .all();

  let totalInvocations = 0;
  let totalDurationMs = 0;
  const breakdown: CostSummary["taskBreakdown"] = [];

  for (const task of taskRows) {
    // Each task = 1 coder invocation + reviewCycles reviewer invocations
    const cycles = task.reviewCycles ?? 0;
    const invocations = 1 + cycles; // coder + review cycles
    totalInvocations += invocations;

    // Try to extract duration from agent output
    let durationMs = 0;
    if (task.agentOutput) {
      const match = task.agentOutput.match(/"durationMs"\s*:\s*(\d+)/);
      if (match) {
        durationMs = parseInt(match[1], 10);
      }
    }
    totalDurationMs += durationMs;

    breakdown.push({
      taskId: task.id,
      title: task.title,
      durationMs,
      reviewCycles: cycles,
    });
  }

  return {
    sessionId,
    totalInvocations,
    totalDurationMs,
    taskBreakdown: breakdown,
  };
}

export function formatCostSummary(cost: CostSummary): string {
  const lines: string[] = [];
  lines.push(`Cost Summary — ${cost.sessionId}`);
  lines.push(`  Total agent invocations: ${cost.totalInvocations}`);
  lines.push(
    `  Total duration: ${(cost.totalDurationMs / 1000).toFixed(1)}s`,
  );
  lines.push("");
  lines.push("  Task Breakdown:");

  for (const task of cost.taskBreakdown) {
    const dur =
      task.durationMs > 0 ? ` (${(task.durationMs / 1000).toFixed(1)}s)` : "";
    lines.push(
      `    ${task.taskId}: ${task.title}${dur} — ${task.reviewCycles} review cycles`,
    );
  }

  return lines.join("\n");
}
