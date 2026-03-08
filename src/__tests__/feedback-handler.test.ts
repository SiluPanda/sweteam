import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, iterations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  buildFeedbackPrompt,
  parsePlanDelta,
  createIteration,
  getIterationHistory,
} from "../orchestrator/feedback-handler.js";
import { createSessionHandlers } from "../session/interactive.js";

describe("feedback-handler — buildFeedbackPrompt", () => {
  it("should include plan, tasks, feedback, and history", () => {
    const prompt = buildFeedbackPrompt(
      '{"tasks":[]}',
      [
        {
          id: "task-001",
          title: "Config",
          status: "done",
          description: "Add config",
          diffPatch: "+export const x = 1;",
        },
      ],
      "Make it faster",
      [{ iterationNumber: 1, feedback: "Change color", planDelta: null }],
    );

    expect(prompt).toContain("Make it faster");
    expect(prompt).toContain("task-001");
    expect(prompt).toContain("Change color");
    expect(prompt).toContain("modified_tasks");
  });

  it("should handle empty iteration history", () => {
    const prompt = buildFeedbackPrompt("{}", [], "Fix bug", []);
    expect(prompt).toContain("first iteration");
  });
});

describe("feedback-handler — parsePlanDelta", () => {
  it("should parse valid JSON delta", () => {
    const delta = parsePlanDelta(
      JSON.stringify({
        modified_tasks: [{ id: "task-001", changes: "Update color" }],
        new_tasks: [
          {
            id: "task-007",
            title: "New task",
            description: "Do something new",
            files_likely_touched: ["src/new.ts"],
            depends_on: [],
            acceptance_criteria: ["Works"],
          },
        ],
        summary: "Updated colors and added new task",
      }),
    );

    expect(delta.modifiedTasks.length).toBe(1);
    expect(delta.modifiedTasks[0].id).toBe("task-001");
    expect(delta.newTasks.length).toBe(1);
    expect(delta.newTasks[0].title).toBe("New task");
    expect(delta.summary).toContain("Updated colors");
  });

  it("should parse JSON in code blocks", () => {
    const delta = parsePlanDelta(
      '```json\n{"modified_tasks":[],"new_tasks":[],"summary":"No changes"}\n```',
    );
    expect(delta.summary).toBe("No changes");
  });

  it("should return empty delta for unparseable input", () => {
    const delta = parsePlanDelta("not json");
    expect(delta.modifiedTasks).toEqual([]);
    expect(delta.newTasks).toEqual([]);
    expect(delta.summary).toContain("Could not parse");
  });
});

describe("feedback-handler — iteration tracking", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-fb-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_fb",
        repo: "owner/repo",
        goal: "Test",
        status: "awaiting_feedback",
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

  it("should create iteration with correct number", () => {
    const num1 = createIteration("s_fb", "First feedback", null);
    expect(num1).toBe(1);

    const num2 = createIteration("s_fb", "Second feedback", null);
    expect(num2).toBe(2);
  });

  it("should return iteration history in order", () => {
    createIteration("s_fb", "Feedback 1", null);
    createIteration("s_fb", "Feedback 2", null);

    const history = getIterationHistory("s_fb");
    expect(history.length).toBe(2);
    expect(history[0].feedback).toBe("Feedback 1");
    expect(history[1].feedback).toBe("Feedback 2");
  });
});

describe("feedback during planning — routes to planner", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-fb-planning-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_plan_fb",
        repo: "owner/repo",
        repoLocalPath: "/tmp/fake-repo",
        goal: "Build a feature",
        status: "planning",
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
    vi.restoreAllMocks();
  });

  it("should delegate to onMessage when session is in planning state", async () => {
    // Mock the planner so it doesn't actually spawn a process
    const plannerMod = await import("../planner/planner.js");
    const plannerSpy = vi.spyOn(plannerMod, "invokePlanner").mockResolvedValue("Refined plan response");

    // Mock agent-log to prevent file I/O
    const agentLogMod = await import("../session/agent-log.js");
    vi.spyOn(agentLogMod, "clearLog").mockImplementation(() => {});
    vi.spyOn(agentLogMod, "writeEvent").mockImplementation(() => {});

    const handlers = createSessionHandlers("s_plan_fb", "owner/repo", "Build a feature", "/tmp/fake-repo");

    // This should NOT throw "Invalid transition: planning → iterating"
    await handlers.onFeedback("Make the plan more comprehensive");

    // Verify it invoked the planner (not handleFeedback's iteration flow)
    expect(plannerSpy).toHaveBeenCalled();

    // Verify the session is still in planning state (not iterating)
    const db = getDb();
    const rows = db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, "s_plan_fb"))
      .all();
    expect(rows[0].status).toBe("planning");
  });

  it("should not invoke planner when session is awaiting_feedback", async () => {
    // Change session to awaiting_feedback
    const db = getDb();
    db.update(sessions)
      .set({ status: "awaiting_feedback" })
      .where(eq(sessions.id, "s_plan_fb"))
      .run();

    // Mock handleFeedback to prevent it from actually running
    const fbMod = await import("../orchestrator/feedback-handler.js");
    const fbSpy = vi.spyOn(fbMod, "handleFeedback").mockResolvedValue();

    const handlers = createSessionHandlers("s_plan_fb", "owner/repo", "Build a feature", "/tmp/fake-repo");
    await handlers.onFeedback("Fix the colors");

    // Verify it called handleFeedback (the iteration path), not the planner
    expect(fbSpy).toHaveBeenCalledWith("s_plan_fb", "Fix the colors");
  });
});
