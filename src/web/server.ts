import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '../db/client.js';
import { sessions, messages, tasks, iterations } from '../db/schema.js';
import { eq, sql, desc } from 'drizzle-orm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.SWETEAM_PORT || '3847', 10);

// Resolve public directory (works for both tsx and compiled dist)
const publicDir = existsSync(join(__dirname, 'public'))
  ? join(__dirname, 'public')
  : join(__dirname, '../../src/web/public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── Helpers ───────────────────────────────────────────────

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse) {
  jsonResponse(res, { error: 'Not found' }, 404);
}

function serverError(res: ServerResponse, err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal server error';
  jsonResponse(res, { error: message }, 500);
}

function serveStatic(res: ServerResponse, filePath: string) {
  const fullPath = join(publicDir, filePath === '/' ? 'index.html' : filePath);
  if (!existsSync(fullPath)) {
    notFound(res);
    return;
  }
  const ext = extname(fullPath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(fullPath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}

function parseUrl(url: string): { path: string; params: Record<string, string> } {
  const [path, query] = url.split('?');
  const params: Record<string, string> = {};
  if (query) {
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { path: path || '/', params };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── API Handlers ──────────────────────────────────────────

function apiGetSessions(res: ServerResponse) {
  try {
    const db = getDb();
    const sessionRows = db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .all();

    const enriched = sessionRows.map((s) => {
      const msgCount = db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.sessionId, s.id))
        .all();
      const taskRows = db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.sessionId, s.id))
        .all();

      return {
        ...s,
        createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : s.createdAt,
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : s.updatedAt,
        stoppedAt: s.stoppedAt instanceof Date ? s.stoppedAt.getTime() : s.stoppedAt,
        messageCount: msgCount[0]?.count ?? 0,
        tasksTotal: taskRows.length,
        tasksDone: taskRows.filter((t) => t.status === 'done').length,
        tasksRunning: taskRows.filter((t) => t.status === 'running').length,
        tasksFailed: taskRows.filter((t) => t.status === 'failed').length,
        tasksBlocked: taskRows.filter((t) => t.status === 'blocked').length,
      };
    });

    jsonResponse(res, enriched);
  } catch (err) {
    serverError(res, err);
  }
}

function apiGetSession(res: ServerResponse, id: string) {
  try {
    const db = getDb();
    const rows = db.select().from(sessions).where(eq(sessions.id, id)).all();
    if (rows.length === 0) return notFound(res);

    const s = rows[0]!;
    const msgCount = db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.sessionId, s.id))
      .all();
    const taskRows = db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.sessionId, s.id))
      .all();

    jsonResponse(res, {
      ...s,
      createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : s.createdAt,
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : s.updatedAt,
      stoppedAt: s.stoppedAt instanceof Date ? s.stoppedAt.getTime() : s.stoppedAt,
      messageCount: msgCount[0]?.count ?? 0,
      tasksTotal: taskRows.length,
      tasksDone: taskRows.filter((t) => t.status === 'done').length,
      tasksRunning: taskRows.filter((t) => t.status === 'running').length,
      tasksFailed: taskRows.filter((t) => t.status === 'failed').length,
      tasksBlocked: taskRows.filter((t) => t.status === 'blocked').length,
    });
  } catch (err) {
    serverError(res, err);
  }
}

function apiGetTasks(res: ServerResponse, sessionId: string) {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(tasks)
      .where(eq(tasks.sessionId, sessionId))
      .orderBy(tasks.order)
      .all();

    const serialized = rows.map((t) => ({
      ...t,
      createdAt: t.createdAt instanceof Date ? t.createdAt.getTime() : t.createdAt,
      updatedAt: t.updatedAt instanceof Date ? t.updatedAt.getTime() : t.updatedAt,
      dependsOn: t.dependsOn ? JSON.parse(t.dependsOn) : [],
      filesLikelyTouched: t.filesLikelyTouched ? JSON.parse(t.filesLikelyTouched) : [],
      acceptanceCriteria: t.acceptanceCriteria ? JSON.parse(t.acceptanceCriteria) : [],
      reviewIssues: t.reviewIssues ? JSON.parse(t.reviewIssues) : [],
    }));

    jsonResponse(res, serialized);
  } catch (err) {
    serverError(res, err);
  }
}

function apiGetMessages(res: ServerResponse, sessionId: string) {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();

    const serialized = rows.map((m) => ({
      ...m,
      createdAt: m.createdAt instanceof Date ? m.createdAt.getTime() : m.createdAt,
      metadata: m.metadata ? JSON.parse(m.metadata) : null,
    }));

    jsonResponse(res, serialized);
  } catch (err) {
    serverError(res, err);
  }
}

function apiGetIterations(res: ServerResponse, sessionId: string) {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(iterations)
      .where(eq(iterations.sessionId, sessionId))
      .orderBy(iterations.iterationNumber)
      .all();

    const serialized = rows.map((i) => ({
      ...i,
      createdAt: i.createdAt instanceof Date ? i.createdAt.getTime() : i.createdAt,
      planDelta: i.planDelta ? JSON.parse(i.planDelta) : null,
    }));

    jsonResponse(res, serialized);
  } catch (err) {
    serverError(res, err);
  }
}

async function apiStopSession(req: IncomingMessage, res: ServerResponse, id: string) {
  try {
    const db = getDb();
    const rows = db.select().from(sessions).where(eq(sessions.id, id)).all();
    if (rows.length === 0) return notFound(res);

    const session = rows[0]!;
    if (session.status === 'stopped') {
      return jsonResponse(res, { error: 'Session is already stopped' }, 400);
    }

    const now = new Date();
    db.update(sessions)
      .set({ status: 'stopped', stoppedAt: now, updatedAt: now })
      .where(eq(sessions.id, id))
      .run();

    // Attempt to kill processes (dynamic import to avoid side effects at module load)
    try {
      const { killSessionProcesses } = await import('../lifecycle.js');
      killSessionProcesses(id);
    } catch {
      // lifecycle module may not be available
    }

    jsonResponse(res, { ok: true });
  } catch (err) {
    serverError(res, err);
  }
}

// ── Router ────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const { path } = parseUrl(req.url || '/');

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API routes
  if (path.startsWith('/api/')) {
    const parts = path.split('/').filter(Boolean); // ["api", "sessions", ...]

    if (method === 'GET' && path === '/api/sessions') {
      return apiGetSessions(res);
    }

    // Match /api/sessions/:id
    if (method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'sessions') {
      return apiGetSession(res, parts[2]!);
    }

    // Match /api/sessions/:id/tasks
    if (
      method === 'GET' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'sessions' &&
      parts[3] === 'tasks'
    ) {
      return apiGetTasks(res, parts[2]!);
    }

    // Match /api/sessions/:id/messages
    if (
      method === 'GET' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'sessions' &&
      parts[3] === 'messages'
    ) {
      return apiGetMessages(res, parts[2]!);
    }

    // Match /api/sessions/:id/iterations
    if (
      method === 'GET' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'sessions' &&
      parts[3] === 'iterations'
    ) {
      return apiGetIterations(res, parts[2]!);
    }

    // Match POST /api/sessions/:id/stop
    if (
      method === 'POST' &&
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'sessions' &&
      parts[3] === 'stop'
    ) {
      return apiStopSession(req, res, parts[2]!);
    }

    return notFound(res);
  }

  // Static files
  serveStatic(res, path);
});

// ── Startup ───────────────────────────────────────────────

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Set a different port: SWETEAM_PORT=3900 npm run web\n`);
    process.exit(1);
  }
  throw err;
});

process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  server.close();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  closeDb();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │                                         │
  │   sweteam web UI                        │
  │   http://localhost:${String(PORT).padEnd(24)}│
  │                                         │
  │   Press Ctrl+C to stop                  │
  │                                         │
  └─────────────────────────────────────────┘
`);
});
