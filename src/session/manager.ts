import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { join } from "path";
import { unlinkSync } from "fs";
import { getDb, SWETEAM_DIR } from "../db/client.js";
import { sessions, messages, tasks as tasksTable } from "../db/schema.js";
import { resolveRepo, cloneOrLocateRepo, createBranch, deleteBranches, getDefaultBranch, git } from "../git/git.js";
import { loadConfig } from "../config/loader.js";
import { killAllProcesses, killSessionProcesses } from "../lifecycle.js";

function generateSessionId(): string {
  return `s_${nanoid(8)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export interface CreateSessionOpts {
  repoInput: string;
  goal?: string;
  /** When true, repoInput is treated as a local path (skip clone). */
  local?: boolean;
}

export async function createSession(
  opts: CreateSessionOpts,
): Promise<{ id: string; repo: string; repoLocalPath: string; workingBranch: string }> {
  const config = loadConfig();

  let repo: string;
  let repoLocalPath: string;

  if (opts.local) {
    // Local workspace — repoInput is an absolute path
    repoLocalPath = opts.repoInput;
    const { repoFromRemote } = await import("../git/git.js");
    repo = repoFromRemote(repoLocalPath) ?? repoLocalPath;
  } else {
    repo = resolveRepo(opts.repoInput);
    repoLocalPath = cloneOrLocateRepo(repo);
  }

  const sessionId = generateSessionId();
  const goal = opts.goal ?? "";
  const slug = goal ? slugify(goal) : "";
  const workingBranch = slug
    ? `${config.execution.branch_prefix}${sessionId}-${slug}`
    : `${config.execution.branch_prefix}${sessionId}`;

  // Branch from the default branch (not HEAD, which may be a stale feature branch)
  const baseBranch = getDefaultBranch(repoLocalPath);
  try { git(["checkout", baseBranch], repoLocalPath); } catch { /* may already be on it */ }
  createBranch(workingBranch, baseBranch, repoLocalPath);

  const db = getDb();
  const now = new Date();

  db.insert(sessions)
    .values({
      id: sessionId,
      repo,
      repoLocalPath,
      goal,
      status: "planning",
      workingBranch,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(messages)
    .values({
      id: nanoid(),
      sessionId,
      role: "system",
      content: `Session created for ${repo}`,
      metadata: JSON.stringify({ phase: "planning" }),
      createdAt: now,
    })
    .run();

  return { id: sessionId, repo, repoLocalPath, workingBranch };
}

export function getSession(id: string) {
  const db = getDb();
  const rows = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .all();

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

export function listSessions() {
  const db = getDb();
  return db
    .select({
      id: sessions.id,
      repo: sessions.repo,
      goal: sessions.goal,
      status: sessions.status,
      prUrl: sessions.prUrl,
      prNumber: sessions.prNumber,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .all();
}

export interface EnrichedSession {
  id: string;
  repo: string;
  goal: string;
  status: string;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
  planReady: boolean;
  messageCount: number;
  tasksDone: number;
  tasksTotal: number;
}

export function listSessionsEnriched(): EnrichedSession[] {
  const db = getDb();
  const sessionRows = db
    .select({
      id: sessions.id,
      repo: sessions.repo,
      goal: sessions.goal,
      status: sessions.status,
      prUrl: sessions.prUrl,
      prNumber: sessions.prNumber,
      planJson: sessions.planJson,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .all();

  return sessionRows.map((s) => {
    const msgRows = db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.sessionId, s.id))
      .all();
    const messageCount = msgRows[0]?.count ?? 0;

    const taskRows = db
      .select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.sessionId, s.id))
      .all();
    const tasksTotal = taskRows.length;
    const tasksDone = taskRows.filter((t) => t.status === "done").length;

    return {
      id: s.id,
      repo: s.repo,
      goal: s.goal,
      status: s.status,
      prUrl: s.prUrl,
      prNumber: s.prNumber,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      planReady: s.planJson != null,
      messageCount,
      tasksDone,
      tasksTotal,
    };
  });
}

export function stopSession(id: string): void {
  const db = getDb();
  const session = getSession(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }

  const now = new Date();
  db.update(sessions)
    .set({ status: "stopped", stoppedAt: now, updatedAt: now })
    .where(eq(sessions.id, id))
    .run();

  // Kill child processes belonging to this session
  killSessionProcesses(id);
}

export function deleteSession(id: string): void {
  const db = getDb();
  const session = getSession(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }

  // Stop any active build processes before deleting
  if (session.status === "building" || session.status === "iterating") {
    killSessionProcesses(id);
  }

  // Clean up git branches associated with this session
  const config = loadConfig();
  const prefix = config.execution.branch_prefix ?? "sw/";
  if (session.repoLocalPath) {
    try {
      // Switch to default branch first so session branch isn't checked out
      const defaultBranch = getDefaultBranch(session.repoLocalPath);
      git(["checkout", defaultBranch], session.repoLocalPath);
    } catch {
      // May already be on default branch or repo may be gone
    }
    try {
      deleteBranches(`${prefix}${id}*`, session.repoLocalPath);
      deleteBranches(`${prefix}${id}-*`, session.repoLocalPath);
    } catch {
      // Git cleanup is best-effort — don't fail the delete
    }
  }

  // Clean up agent log files
  try {
    const logPath = join(SWETEAM_DIR, "logs", `${id}.jsonl`);
    unlinkSync(logPath);
  } catch {
    // Log file may not exist
  }

  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function addMessage(
  sessionId: string,
  role: "user" | "agent" | "system",
  content: string,
  metadata?: Record<string, unknown>,
): string {
  const db = getDb();
  const id = nanoid();

  db.insert(messages)
    .values({
      id,
      sessionId,
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: new Date(),
    })
    .run();

  return id;
}

export function getMessages(sessionId: string, limit?: number) {
  const db = getDb();
  const query = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);

  const rows = query.all();

  if (limit && limit > 0) {
    return rows.slice(-limit);
  }

  return rows;
}
