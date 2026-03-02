import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, tasks as tasksTable } from "../db/schema.js";
import { transition } from "../session/state-machine.js";
import { addMessage, getSession } from "../session/manager.js";
import { parsePlan } from "../planner/plan-parser.js";
import {
  insertTasksFromPlan,
  getTasksForSession,
  runOrchestrator,
  type OrchestratorCallbacks,
} from "./orchestrator.js";
import { pushBranch, createPR } from "../git/git.js";
import { AgentPanel } from "../ui/agent-panel.js";

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
  lines.push("");
  lines.push("## Tasks");

  for (const task of allTasks) {
    let icon: string;
    switch (task.status) {
      case "done":
        icon = "✓";
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
    lines.push(`- ${icon} ${task.id}: ${task.title}`);
  }

  lines.push("");
  lines.push("## Summary");
  lines.push(
    `${taskResults.completed.length} completed, ${taskResults.failed.length} failed, ${taskResults.blocked.length} blocked`,
  );

  if (taskResults.failed.length > 0) {
    lines.push("");
    lines.push("## Escalated Tasks");
    for (const id of taskResults.failed) {
      const task = allTasks.find((t) => t.id === id);
      lines.push(`- ${id}: ${task?.title ?? "unknown"}`);
    }
  }

  return lines.join("\n");
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
  lines.push("Build complete.");
  lines.push("");

  for (const task of allTasks) {
    let prefix: string;
    switch (task.status) {
      case "done":
        prefix = "  ✓";
        break;
      case "failed":
        prefix = "  ⚠";
        break;
      case "blocked":
        prefix = "  ⊘";
        break;
      default:
        prefix = "  ○";
    }
    lines.push(`${prefix} ${task.id}  ${task.title}`);
  }

  lines.push("");
  if (prUrl) {
    lines.push(`PR: ${prUrl}`);
  }
  lines.push("");
  lines.push("Review the PR and type @feedback with any changes needed.");

  return lines.join("\n");
}

export async function handleBuild(
  sessionId: string,
  planOutput: string,
): Promise<void> {
  const db = getDb();

  // Parse the plan
  const plan = parsePlan(planOutput);

  if (plan.tasks.length === 0) {
    const msg = "Could not parse tasks from the plan. Please refine the plan and try @build again.";
    addMessage(sessionId, "system", msg);
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
  transition(sessionId, "building");

  // Clean up any leftover tasks from a previous failed build
  db.delete(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .run();

  // Insert tasks into DB
  insertTasksFromPlan(sessionId, plan.tasks);

  addMessage(
    sessionId,
    "system",
    `Plan finalized with ${plan.tasks.length} tasks. Starting build...`,
  );

  // Print task list so the user sees what will be built
  console.log(`Found ${plan.tasks.length} tasks:\n`);
  for (const t of plan.tasks) {
    const deps = t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(", ")})` : "";
    console.log(`  ${t.id}  ${t.title}${deps}`);
  }
  console.log();

  // Run the orchestrator
  const session = getSession(sessionId)!;
  const repoPath = session.repoLocalPath!;
  const sessionBranch = session.workingBranch!;

  const panel = new AgentPanel();
  let agentCounter = 0;
  const callbacks: OrchestratorCallbacks = {
    onAgentStart: (taskId, taskTitle, role) => {
      panel.addAgent(`${role.toLowerCase()}-${++agentCounter}`, role, taskId, taskTitle);
    },
    onAgentOutput: (_taskId, role, chunk) => {
      const id = `${role.toLowerCase()}-${agentCounter}`;
      panel.appendOutput(id, chunk);
    },
    onAgentEnd: (_taskId, role, success) => {
      const id = `${role.toLowerCase()}-${agentCounter}`;
      panel.completeAgent(id, success);
    },
  };

  const result = await runOrchestrator(sessionId, repoPath, sessionBranch, callbacks);
  panel.destroy();

  // Get final task states
  const allTasks = getTasksForSession(sessionId).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
  }));

  // Push and create PR if any tasks completed
  let prUrl: string | undefined;
  if (result.completed.length > 0) {
    try {
      pushBranch(sessionBranch, repoPath);

      const prBody = generatePrBody(session.goal, result, allTasks);
      prUrl = createPR(session.goal, prBody, "main", sessionBranch, repoPath);

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
      addMessage(sessionId, "system", `Failed to create PR: ${errMsg}`);
    }
  }

  // Transition to awaiting_feedback
  transition(sessionId, "awaiting_feedback");

  // Print completion report
  const report = formatCompletionReport(result, allTasks, prUrl);
  addMessage(sessionId, "system", report);
  console.log(report);
}
