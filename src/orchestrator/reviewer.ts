import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { squashMerge, git } from "../git/git.js";
import { resolveAdapter } from "../adapters/adapter.js";
import { loadConfig } from "../config/loader.js";
import type { TaskRecord } from "./task-runner.js";

export interface ReviewResult {
  verdict: "approve" | "request_changes";
  issues: Array<{
    file?: string;
    line?: number;
    severity?: "error" | "warning";
    message: string;
  }>;
  summary: string;
}

export function buildReviewerPrompt(
  task: TaskRecord,
  diff: string,
): string {
  const criteria = task.acceptanceCriteria
    ? JSON.parse(task.acceptanceCriteria)
        .map((c: string) => `- ${c}`)
        .join("\n")
    : "(none specified)";

  return `You are a senior code reviewer. Review this diff for:
1. Correctness — does it meet the acceptance criteria?
2. Quality — clean code, no obvious bugs, proper error handling
3. Scope — only changes what's needed

## Task
${task.title}: ${task.description}

## Acceptance Criteria
${criteria}

## Diff
${diff}

Respond with ONLY valid JSON:
{
  "verdict": "approve" | "request_changes",
  "issues": [
    { "file": "...", "line": 42, "severity": "error|warning", "message": "..." }
  ],
  "summary": "Overall assessment"
}`;
}

export function parseReviewResponse(output: string): ReviewResult {
  // Try to extract JSON from response
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : output;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      verdict: parsed.verdict === "approve" ? "approve" : "request_changes",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: String(parsed.summary ?? ""),
    };
  } catch {
    // If parsing fails, treat as approval (conservative)
    return {
      verdict: "approve",
      issues: [],
      summary: "Review response could not be parsed; auto-approving.",
    };
  }
}

export async function reviewTask(
  task: TaskRecord,
  diff: string,
  repoPath: string,
): Promise<ReviewResult> {
  const config = loadConfig();
  const adapter = resolveAdapter(config.roles.reviewer, config);

  const prompt = buildReviewerPrompt(task, diff);

  const result = await adapter.execute({
    prompt,
    cwd: repoPath,
    timeout: 120000,
  });

  return parseReviewResponse(result.output);
}

export function mergeTask(
  task: TaskRecord,
  sessionBranch: string,
  repoPath: string,
): void {
  const db = getDb();

  if (!task.branchName) {
    throw new Error(`Task ${task.id} has no branch name`);
  }

  squashMerge(
    task.branchName,
    sessionBranch,
    `feat: ${task.title} (#${task.id})`,
    repoPath,
  );

  db.update(tasks)
    .set({
      status: "done",
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .run();
}

export async function reviewAndMerge(
  task: TaskRecord,
  sessionBranch: string,
  repoPath: string,
  maxCycles: number = 3,
): Promise<{ merged: boolean; reviewResult: ReviewResult }> {
  const config = loadConfig();
  const db = getDb();

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    // Get current diff
    const diff =
      task.diffPatch || git(`diff ${sessionBranch}...${task.branchName}`, repoPath);

    const reviewResult = await reviewTask(task, diff, repoPath);

    // Update review info in DB
    db.update(tasks)
      .set({
        reviewVerdict: reviewResult.verdict,
        reviewIssues: JSON.stringify(reviewResult.issues),
        reviewCycles: cycle + 1,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();

    if (reviewResult.verdict === "approve") {
      mergeTask(task, sessionBranch, repoPath);
      return { merged: true, reviewResult };
    }

    // Request changes — feed issues back to coder
    if (cycle < maxCycles - 1) {
      db.update(tasks)
        .set({ status: "fixing", updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();

      const coderAdapter = resolveAdapter(config.roles.coder, config);
      const fixPrompt = `The reviewer found issues with your implementation. Fix them:

${reviewResult.issues.map((i) => `- ${i.file ?? ""}:${i.line ?? ""} [${i.severity ?? "error"}] ${i.message}`).join("\n")}

Summary: ${reviewResult.summary}`;

      await coderAdapter.execute({
        prompt: fixPrompt,
        cwd: repoPath,
        timeout: 300000,
      });

      // Re-commit fixes
      try {
        git("add -A", repoPath);
        git(`commit -m "fix(${task.id}): address review feedback (cycle ${cycle + 2})"`, repoPath);
      } catch {
        // No changes to commit
      }

      db.update(tasks)
        .set({ status: "reviewing", updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();
    }
  }

  // Max cycles exhausted
  db.update(tasks)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(tasks.id, task.id))
    .run();

  return {
    merged: false,
    reviewResult: {
      verdict: "request_changes",
      issues: [],
      summary: `Failed after ${maxCycles} review cycles`,
    },
  };
}
