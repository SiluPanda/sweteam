import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, tasks as tasksTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  propagateFailure,
  persistError,
} from "../orchestrator/error-handling.js";
import type { TaskRecord } from "../orchestrator/task-runner.js";

describe("error-handling — propagateFailure", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-err-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_err",
        repo: "owner/repo",
        goal: "Test",
        status: "building",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // Insert tasks with dependencies
    const now = new Date();
    db.insert(tasksTable)
      .values([
        { id: "t-1", sessionId: "s_err", title: "T1", description: "D1", status: "failed", order: 1, createdAt: now, updatedAt: now },
        { id: "t-2", sessionId: "s_err", title: "T2", description: "D2", status: "queued", dependsOn: '["t-1"]', order: 2, createdAt: now, updatedAt: now },
        { id: "t-3", sessionId: "s_err", title: "T3", description: "D3", status: "queued", dependsOn: '["t-2"]', order: 3, createdAt: now, updatedAt: now },
        { id: "t-4", sessionId: "s_err", title: "T4", description: "D4", status: "queued", order: 4, createdAt: now, updatedAt: now },
      ])
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should block direct dependents of failed task", () => {
    const allTasks: TaskRecord[] = [
      { id: "t-1", sessionId: "s_err", title: "T1", description: "D1", status: "failed", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: null, branchName: null },
      { id: "t-2", sessionId: "s_err", title: "T2", description: "D2", status: "queued", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: '["t-1"]', branchName: null },
      { id: "t-3", sessionId: "s_err", title: "T3", description: "D3", status: "queued", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: '["t-2"]', branchName: null },
      { id: "t-4", sessionId: "s_err", title: "T4", description: "D4", status: "queued", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: null, branchName: null },
    ];

    const blocked = propagateFailure("t-1", "s_err", allTasks);

    expect(blocked).toContain("t-2");
    expect(blocked).toContain("t-3"); // cascading
    expect(blocked).not.toContain("t-4"); // independent
  });

  it("should not block independent tasks", () => {
    const allTasks: TaskRecord[] = [
      { id: "t-1", sessionId: "s_err", title: "T1", description: "D1", status: "failed", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: null, branchName: null },
      { id: "t-4", sessionId: "s_err", title: "T4", description: "D4", status: "queued", filesLikelyTouched: null, acceptanceCriteria: null, dependsOn: null, branchName: null },
    ];

    const blocked = propagateFailure("t-1", "s_err", allTasks);
    expect(blocked).toEqual([]);
  });
});

describe("error-handling — persistError", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-perr-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_perr",
        repo: "owner/repo",
        goal: "Test",
        status: "building",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(tasksTable)
      .values({
        id: "t-err",
        sessionId: "s_perr",
        title: "Task",
        description: "Desc",
        status: "running",
        order: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should mark task as failed and store error", () => {
    persistError("s_perr", "t-err", "Something went wrong", "execution");

    const db = getDb();
    const rows = db
      .select({ status: tasksTable.status, agentOutput: tasksTable.agentOutput })
      .from(tasksTable)
      .where(eq(tasksTable.id, "t-err"))
      .all();

    expect(rows[0].status).toBe("failed");
    expect(rows[0].agentOutput).toContain("Something went wrong");
    expect(rows[0].agentOutput).toContain("[execution]");
  });
});
