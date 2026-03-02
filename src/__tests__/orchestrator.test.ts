import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, tasks as tasksTable } from "../db/schema.js";
import {
  insertTasksFromPlan,
  getTasksForSession,
} from "../orchestrator/orchestrator.js";
import type { ParsedTask } from "../planner/plan-parser.js";

describe("orchestrator — insertTasksFromPlan", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-orch-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_orch",
        repo: "owner/repo",
        goal: "Test",
        status: "building",
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

  it("should insert tasks into the database", () => {
    const parsedTasks: ParsedTask[] = [
      {
        id: "task-001",
        title: "First task",
        description: "Do the first thing",
        filesLikelyTouched: ["src/a.ts"],
        dependsOn: [],
        acceptanceCriteria: ["Tests pass"],
      },
      {
        id: "task-002",
        title: "Second task",
        description: "Do the second thing",
        filesLikelyTouched: ["src/b.ts"],
        dependsOn: ["task-001"],
        acceptanceCriteria: ["Works correctly"],
      },
    ];

    insertTasksFromPlan("s_orch", parsedTasks);

    const tasks = getTasksForSession("s_orch");
    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe("task-001");
    expect(tasks[0].status).toBe("queued");
    expect(tasks[1].id).toBe("task-002");
    expect(tasks[1].dependsOn).toBe(JSON.stringify(["task-001"]));
  });

  it("should set correct order", () => {
    const parsedTasks: ParsedTask[] = [
      {
        id: "task-001",
        title: "A",
        description: "A",
        filesLikelyTouched: [],
        dependsOn: [],
        acceptanceCriteria: [],
      },
      {
        id: "task-002",
        title: "B",
        description: "B",
        filesLikelyTouched: [],
        dependsOn: [],
        acceptanceCriteria: [],
      },
    ];

    insertTasksFromPlan("s_orch", parsedTasks);

    const db = getDb();
    const rows = db
      .select({ id: tasksTable.id, order: tasksTable.order })
      .from(tasksTable)
      .orderBy(tasksTable.order)
      .all();

    expect(rows[0].order).toBe(1);
    expect(rows[1].order).toBe(2);
  });
});

describe("orchestrator — getTasksForSession", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-orch2-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_tasks",
        repo: "owner/repo",
        goal: "Test",
        status: "building",
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

  it("should return empty array when no tasks", () => {
    const tasks = getTasksForSession("s_tasks");
    expect(tasks).toEqual([]);
  });

  it("should return tasks ordered by order field", () => {
    const parsedTasks: ParsedTask[] = [
      { id: "t-1", title: "T1", description: "D1", filesLikelyTouched: [], dependsOn: [], acceptanceCriteria: [] },
      { id: "t-2", title: "T2", description: "D2", filesLikelyTouched: [], dependsOn: [], acceptanceCriteria: [] },
    ];
    insertTasksFromPlan("s_tasks", parsedTasks);

    const tasks = getTasksForSession("s_tasks");
    expect(tasks[0].id).toBe("t-1");
    expect(tasks[1].id).toBe("t-2");
  });
});
