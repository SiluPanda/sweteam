import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tasks } from '../db/schema.js';
import { git, createBranch, getDiff, getStagedDiff, commitAll } from '../git/git.js';
import { resolveAdapter } from '../adapters/adapter.js';
import { loadConfig } from '../config/loader.js';
import { displayTaskId } from './orchestrator.js';
import { safeJsonParse } from './dag.js';

export interface TaskRecord {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  filesLikelyTouched: string | null;
  acceptanceCriteria: string | null;
  dependsOn: string | null;
  branchName: string | null;
  status: string;
  diffPatch?: string | null;
}

export function buildCoderPrompt(task: TaskRecord, dependencyDiffs: string[]): string {
  const files = task.filesLikelyTouched
    ? safeJsonParse<string[]>(task.filesLikelyTouched, []).join('\n') || '(not specified)'
    : '(not specified)';

  const criteria = task.acceptanceCriteria
    ? safeJsonParse<string[]>(task.acceptanceCriteria, [])
        .map((c: string) => `- ${c}`)
        .join('\n') || '(none specified)'
    : '(none specified)';

  const contextDiffs =
    dependencyDiffs.length > 0 ? dependencyDiffs.join('\n\n---\n\n') : '(no prior tasks)';

  return `You are implementing a specific task in a larger project.

## Task
${task.title}

## Description
${task.description}

## Acceptance Criteria
${criteria}

## Files You'll Likely Touch
${files}

## Context from Completed Tasks
${contextDiffs}

Implement this task completely. Create or modify files as needed.
Do not implement anything outside the scope of this task.`;
}

export function getDependencyDiffs(task: TaskRecord): string[] {
  if (!task.dependsOn) return [];

  const db = getDb();
  const depIds: string[] = safeJsonParse(task.dependsOn, []);
  const diffs: string[] = [];

  for (const depId of depIds) {
    const rows = db
      .select({ diffPatch: tasks.diffPatch })
      .from(tasks)
      .where(eq(tasks.id, depId))
      .all();

    if (rows.length > 0 && rows[0].diffPatch) {
      diffs.push(rows[0].diffPatch);
    }
  }

  return diffs;
}

export async function runTask(
  task: TaskRecord,
  sessionBranch: string,
  repoPath: string,
  onOutput?: (chunk: string) => void,
  onInputNeeded?: (promptText: string) => Promise<string | null>,
  options?: { worktreePath?: string; images?: string[] },
): Promise<{ success: boolean; output: string; diff: string }> {
  const config = loadConfig();
  const db = getDb();
  const cwd = options?.worktreePath ?? repoPath;

  // Create task branch — use dash separator to avoid git ref conflicts.
  // Session branch is "sw/s_ID" so task branch must NOT nest under it
  // (git forbids both refs/heads/sw/X and refs/heads/sw/X/Y).
  // e.g. "s_UclHjgC1:1" → "sw/s_UclHjgC1-1-add-cachetools-dependency"
  const safeBranchId = task.id.replace(/:/g, '-').replace(/[^a-zA-Z0-9/_-]/g, '');
  const branchName = `sw/${safeBranchId}-${task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30)}`;

  if (!options?.worktreePath) {
    createBranch(branchName, sessionBranch, repoPath);
  }

  // Update task in DB
  db.update(tasks)
    .set({
      status: 'running',
      branchName,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .run();

  // Build prompt
  const depDiffs = getDependencyDiffs(task);
  const prompt = buildCoderPrompt(task, depDiffs);

  // Invoke coder agent
  const adapter = resolveAdapter(config.roles.coder, config);

  try {
    const result = await adapter.execute({
      prompt,
      cwd,
      timeout: 0,
      images: options?.images,
      onOutput,
      onInputNeeded,
    });

    // Commit any uncommitted changes the coder left behind (staged, unstaged, or untracked)
    const hasUnstaged = getDiff(cwd).length > 0;
    const hasStaged = getStagedDiff(cwd).length > 0;
    const hasUntracked = git(['ls-files', '--others', '--exclude-standard'], cwd).length > 0;
    if (hasUnstaged || hasStaged || hasUntracked) {
      commitAll(`feat(${displayTaskId(task.id)}): ${task.title}`, cwd);
    }

    // Capture the full diff of this task branch vs the session branch
    const diff = git(['diff', `${sessionBranch}...HEAD`], cwd);

    // Update DB with results
    db.update(tasks)
      .set({
        agentOutput: result.output,
        diffPatch: diff || null,
        status: 'reviewing',
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();

    return { success: true, output: result.output, diff };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    db.update(tasks)
      .set({
        status: 'failed',
        agentOutput: `Error: ${message}`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();

    return { success: false, output: message, diff: '' };
  }
}
