import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/client.js";
import { sessions, iterations, tasks as tasksTable } from "../db/schema.js";
import { transition } from "../session/state-machine.js";
import { addMessage, getSession } from "../session/manager.js";
import { resolveAdapter } from "../adapters/adapter.js";
import { loadConfig } from "../config/loader.js";
import {
  getTasksForSession,
  insertTasksFromPlan,
  runOrchestrator,
  type OrchestratorCallbacks,
} from "./orchestrator.js";
import { pushBranch } from "../git/git.js";
import { AgentPanel } from "../ui/agent-panel.js";

export interface PlanDelta {
  modifiedTasks: Array<{ id: string; changes: string }>;
  newTasks: Array<{
    id: string;
    title: string;
    description: string;
    filesLikelyTouched: string[];
    dependsOn: string[];
    acceptanceCriteria: string[];
  }>;
  summary: string;
}

export function buildFeedbackPrompt(
  planJson: string,
  allTasks: Array<{
    id: string;
    title: string;
    status: string;
    description: string;
    diffPatch: string | null;
  }>,
  feedbackText: string,
  iterationHistory: Array<{
    iterationNumber: number;
    feedback: string;
    planDelta: string | null;
  }>,
): string {
  const tasksSummary = allTasks
    .map(
      (t) =>
        `- ${t.id} [${t.status}]: ${t.title}\n  ${t.description}${t.diffPatch ? `\n  Diff: ${t.diffPatch.slice(0, 500)}` : ""}`,
    )
    .join("\n");

  const historyText =
    iterationHistory.length > 0
      ? iterationHistory
          .map(
            (i) =>
              `Iteration ${i.iterationNumber}: ${i.feedback}${i.planDelta ? `\nDelta: ${i.planDelta}` : ""}`,
          )
          .join("\n\n")
      : "(first iteration)";

  return `The user has reviewed the PR and has feedback. Determine what needs to change.

## Original Plan
${planJson}

## Current State of Tasks
${tasksSummary}

## User Feedback
${feedbackText}

## Previous Iterations
${historyText}

Respond with ONLY valid JSON — a plan delta:
{
  "modified_tasks": [
    { "id": "task-003", "changes": "Description of what to change" }
  ],
  "new_tasks": [
    { "id": "task-007", "title": "...", "description": "...", "files_likely_touched": [], "depends_on": [], "acceptance_criteria": [] }
  ],
  "summary": "What's changing and why"
}`;
}

export function parsePlanDelta(output: string): PlanDelta {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : output;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      modifiedTasks: Array.isArray(parsed.modified_tasks)
        ? parsed.modified_tasks
        : [],
      newTasks: Array.isArray(parsed.new_tasks)
        ? parsed.new_tasks.map(
            (t: Record<string, unknown>) => ({
              id: String(t.id ?? `task-${nanoid(4)}`),
              title: String(t.title ?? ""),
              description: String(t.description ?? ""),
              filesLikelyTouched: Array.isArray(t.files_likely_touched)
                ? t.files_likely_touched.map(String)
                : [],
              dependsOn: Array.isArray(t.depends_on)
                ? t.depends_on.map(String)
                : [],
              acceptanceCriteria: Array.isArray(t.acceptance_criteria)
                ? t.acceptance_criteria.map(String)
                : [],
            }),
          )
        : [],
      summary: String(parsed.summary ?? ""),
    };
  } catch {
    return {
      modifiedTasks: [],
      newTasks: [],
      summary: "Could not parse plan delta from agent response.",
    };
  }
}

export function applyPlanDelta(
  sessionId: string,
  delta: PlanDelta,
): void {
  const db = getDb();

  // Re-queue modified tasks
  for (const mod of delta.modifiedTasks) {
    db.update(tasksTable)
      .set({
        status: "queued",
        description: mod.changes,
        reviewVerdict: null,
        reviewIssues: null,
        reviewCycles: 0,
        diffPatch: null,
        agentOutput: null,
        branchName: null,
        updatedAt: new Date(),
      })
      .where(eq(tasksTable.id, mod.id))
      .run();
  }

  // Insert new tasks
  if (delta.newTasks.length > 0) {
    // Get max order
    const existing = getTasksForSession(sessionId);
    const maxOrder =
      existing.length > 0
        ? Math.max(...existing.map((_, i) => i + 1))
        : 0;

    insertTasksFromPlan(
      sessionId,
      delta.newTasks.map((t, i) => ({
        ...t,
        // Override order in insertTasksFromPlan
      })),
    );
  }
}

export function createIteration(
  sessionId: string,
  feedbackText: string,
  planDelta: PlanDelta | null,
): number {
  const db = getDb();

  // Get next iteration number
  const existing = db
    .select({ iterationNumber: iterations.iterationNumber })
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .all();

  const nextNumber =
    existing.length > 0
      ? Math.max(...existing.map((i) => i.iterationNumber)) + 1
      : 1;

  db.insert(iterations)
    .values({
      id: nanoid(),
      sessionId,
      iterationNumber: nextNumber,
      feedback: feedbackText,
      planDelta: planDelta ? JSON.stringify(planDelta) : null,
      status: "building",
      createdAt: new Date(),
    })
    .run();

  return nextNumber;
}

export function getIterationHistory(sessionId: string) {
  const db = getDb();
  return db
    .select({
      iterationNumber: iterations.iterationNumber,
      feedback: iterations.feedback,
      planDelta: iterations.planDelta,
    })
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .orderBy(iterations.iterationNumber)
    .all();
}

export async function handleFeedback(
  sessionId: string,
  feedbackText: string,
): Promise<void> {
  const config = loadConfig();
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  // Store feedback
  addMessage(sessionId, "user", feedbackText, { type: "feedback" });

  // Transition to iterating
  transition(sessionId, "iterating");

  // Get current state
  const db = getDb();
  const allTasks = db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      description: tasksTable.description,
      diffPatch: tasksTable.diffPatch,
    })
    .from(tasksTable)
    .where(eq(tasksTable.sessionId, sessionId))
    .all();

  const iterHistory = getIterationHistory(sessionId);

  // Build feedback prompt and invoke planner
  const prompt = buildFeedbackPrompt(
    session.planJson ?? "{}",
    allTasks,
    feedbackText,
    iterHistory,
  );

  const panel = new AgentPanel();
  let agentCounter = 0;

  // Planner phase
  panel.addAgent("planner-1", "Planner", sessionId, "Analyzing feedback");
  agentCounter++;
  const adapter = resolveAdapter(config.roles.planner, config);
  const result = await adapter.execute({
    prompt,
    cwd: session.repoLocalPath ?? ".",
    timeout: 0,
    onOutput: (chunk: string) => panel.appendOutput("planner-1", chunk),
  });
  panel.completeAgent("planner-1", true);

  // Parse the plan delta
  const delta = parsePlanDelta(result.output);

  // Track iteration
  const iterNum = createIteration(sessionId, feedbackText, delta);

  addMessage(
    sessionId,
    "system",
    `Iteration ${iterNum}: ${delta.summary}\nModified: ${delta.modifiedTasks.length} tasks, New: ${delta.newTasks.length} tasks`,
  );

  // Apply delta
  applyPlanDelta(sessionId, delta);

  // Re-run orchestrator on modified/new tasks
  const repoPath = session.repoLocalPath!;
  const sessionBranch = session.workingBranch!;

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

  await runOrchestrator(sessionId, repoPath, sessionBranch, callbacks);
  panel.destroy();

  // Push updates
  try {
    pushBranch(sessionBranch, repoPath);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    addMessage(sessionId, "system", `Failed to push: ${errMsg}`);
  }

  // Update iteration status
  db.update(iterations)
    .set({ status: "done" })
    .where(eq(iterations.sessionId, sessionId))
    .run();

  // Transition back
  transition(sessionId, "awaiting_feedback");

  addMessage(sessionId, "system", `Iteration ${iterNum} complete. PR updated.`);
}
