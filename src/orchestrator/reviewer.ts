import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tasks } from '../db/schema.js';
import { squashMerge, git } from '../git/git.js';
import { resolveAdapter } from '../adapters/adapter.js';
import { loadConfig } from '../config/loader.js';
import { displayTaskId } from './orchestrator.js';
import type { TaskRecord } from './task-runner.js';

export interface ReviewResult {
  verdict: 'approve' | 'request_changes';
  issues: Array<{
    file?: string;
    line?: number;
    severity?: 'error' | 'warning';
    message: string;
  }>;
  summary: string;
}

export function buildReviewerPrompt(task: TaskRecord, diff: string): string {
  const criteria = task.acceptanceCriteria
    ? JSON.parse(task.acceptanceCriteria)
        .map((c: string) => `- ${c}`)
        .join('\n')
    : '(none specified)';

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
      verdict: parsed.verdict === 'approve' ? 'approve' : 'request_changes',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: String(parsed.summary ?? ''),
    };
  } catch {
    // If parsing fails, reject — never auto-approve unreviewed code
    return {
      verdict: 'request_changes',
      issues: [{ message: 'Review response could not be parsed as valid JSON' }],
      summary: 'Review response could not be parsed; requesting changes as a safety measure.',
    };
  }
}

export async function reviewTask(
  task: TaskRecord,
  diff: string,
  repoPath: string,
  onOutput?: (chunk: string) => void,
  onInputNeeded?: (promptText: string) => Promise<string | null>,
): Promise<ReviewResult> {
  const config = loadConfig();
  const adapter = resolveAdapter(config.roles.reviewer, config);

  const prompt = buildReviewerPrompt(task, diff);

  const result = await adapter.execute({
    prompt,
    cwd: repoPath,
    timeout: 0,
    onOutput,
    onInputNeeded,
  });

  return parseReviewResponse(result.output);
}

export function mergeTask(task: TaskRecord, sessionBranch: string, repoPath: string): void {
  const db = getDb();

  if (!task.branchName) {
    throw new Error(`Task ${task.id} has no branch name`);
  }

  squashMerge(
    task.branchName,
    sessionBranch,
    `feat: ${task.title} (#${displayTaskId(task.id)})`,
    repoPath,
  );

  db.update(tasks)
    .set({
      status: 'done',
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
  onOutput?: (chunk: string) => void,
  onInputNeeded?: (promptText: string) => Promise<string | null>,
  options?: {
    /** Working directory for the task (worktree path). Defaults to repoPath. */
    taskCwd?: string;
    /** Lock wrapper for serializing merge operations in parallel mode. */
    withMergeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<{ merged: boolean; reviewResult: ReviewResult }> {
  const config = loadConfig();
  const db = getDb();
  const taskCwd = options?.taskCwd ?? repoPath;
  const lock = options?.withMergeLock ?? (async <T>(fn: () => Promise<T>) => fn());

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    // Always get a fresh diff for this review cycle
    const diff = git(['diff', `${sessionBranch}...${task.branchName}`], repoPath);

    const reviewResult = await reviewTask(task, diff, repoPath, onOutput, onInputNeeded);

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

    if (reviewResult.verdict === 'approve') {
      try {
        await lock(async () => mergeTask(task, sessionBranch, repoPath));
      } catch (mergeErr) {
        const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        // Attempt to abort a failed merge to restore clean state
        try {
          git(['merge', '--abort'], repoPath);
        } catch {
          /* no merge in progress */
        }
        db.update(tasks)
          .set({
            status: 'failed',
            agentOutput: `Merge failed: ${mergeMsg}`,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, task.id))
          .run();
        return {
          merged: false,
          reviewResult: {
            verdict: 'request_changes',
            issues: [{ message: `Merge failed: ${mergeMsg}` }],
            summary: mergeMsg,
          },
        };
      }
      return { merged: true, reviewResult };
    }

    // Request changes — feed issues back to coder
    if (cycle < maxCycles - 1) {
      db.update(tasks)
        .set({ status: 'fixing', updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();

      // Ensure we're on the task branch before invoking the coder for fixes
      if (task.branchName) {
        try {
          git(['checkout', task.branchName], taskCwd);
        } catch {
          /* may already be on it */
        }
      }

      const coderAdapter = resolveAdapter(config.roles.coder, config);
      const fixPrompt = `The reviewer found issues with your implementation. Fix them:

${reviewResult.issues.map((i) => `- ${i.file ?? ''}:${i.line ?? ''} [${i.severity ?? 'error'}] ${i.message}`).join('\n')}

Summary: ${reviewResult.summary}`;

      await coderAdapter.execute({
        prompt: fixPrompt,
        cwd: taskCwd,
        timeout: 0,
        onOutput,
        onInputNeeded,
      });

      // Re-commit fixes
      try {
        git(['add', '-A'], taskCwd);
        git(
          [
            'commit',
            '-m',
            `fix(${displayTaskId(task.id)}): address review feedback (cycle ${cycle + 2})`,
          ],
          taskCwd,
        );
      } catch {
        // No changes to commit
      }

      db.update(tasks)
        .set({ status: 'reviewing', updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();
    }
  }

  // Max cycles exhausted — force-accept the changes rather than failing the task.
  // The coder has already attempted fixes; accept what we have.
  const forceResult: ReviewResult = {
    verdict: 'approve',
    issues: [],
    summary: `Auto-accepted after ${maxCycles} review cycles (max reached)`,
  };

  db.update(tasks)
    .set({
      reviewVerdict: forceResult.verdict,
      reviewIssues: JSON.stringify(forceResult.issues),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .run();

  try {
    await lock(async () => mergeTask(task, sessionBranch, repoPath));
  } catch (mergeErr) {
    const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
    try {
      git(['merge', '--abort'], repoPath);
    } catch {
      /* no merge in progress */
    }
    db.update(tasks)
      .set({
        status: 'failed',
        agentOutput: `Merge failed after forced accept: ${mergeMsg}`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();
    return {
      merged: false,
      reviewResult: {
        verdict: 'request_changes',
        issues: [{ message: `Merge failed: ${mergeMsg}` }],
        summary: mergeMsg,
      },
    };
  }

  return { merged: true, reviewResult: forceResult };
}
