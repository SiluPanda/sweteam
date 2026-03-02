import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, messages, tasks as tasksTable } from "../db/schema.js";
import { resolveRepo, cloneOrLocateRepo, createBranch } from "../git/git.js";
import { loadConfig } from "../config/loader.js";

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

export async function createSession(
  repoInput: string,
  goal: string,
): Promise<{ id: string; repo: string; repoLocalPath: string; workingBranch: string }> {
  const config = loadConfig();
  const repo = resolveRepo(repoInput);
  const repoLocalPath = cloneOrLocateRepo(repo);

  const sessionId = generateSessionId();
  const slug = slugify(goal);
  const workingBranch = `${config.execution.branch_prefix}${sessionId}-${slug}`;

  createBranch(workingBranch, "HEAD", repoLocalPath);

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
}

export function deleteSession(id: string): void {
  const db = getDb();
  const session = getSession(id);
  if (!session) {
    throw new Error(`Session not found: ${id}`);
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
