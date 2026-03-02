import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, messages, tasks, iterations } from "../db/schema.js";

import { buildDetailedView, formatDetailedView } from "../commands/show.js";

describe("commands/show", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-show-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_show1",
        repo: "owner/repo",
        goal: "Add dark mode",
        status: "building",
        workingBranch: "sw/s_show1-add-dark-mode",
        planJson: JSON.stringify({ tasks: [{ id: "task-001", title: "Setup" }] }),
        createdAt: new Date("2026-02-28T10:00:00Z"),
        updatedAt: new Date("2026-03-01T08:00:00Z"),
      })
      .run();

    db.insert(messages)
      .values({
        id: "msg-1",
        sessionId: "s_show1",
        role: "system",
        content: "Session created for owner/repo",
        createdAt: new Date("2026-02-28T10:00:00Z"),
      })
      .run();

    db.insert(tasks)
      .values({
        id: "task-001",
        sessionId: "s_show1",
        title: "Set up theme config",
        description: "Configure theme system",
        status: "done",
        order: 1,
        reviewVerdict: "approve",
        reviewCycles: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(tasks)
      .values({
        id: "task-002",
        sessionId: "s_show1",
        title: "Create dark palette",
        description: "Define dark color palette",
        status: "running",
        order: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(tasks)
      .values({
        id: "task-003",
        sessionId: "s_show1",
        title: "Update components",
        description: "Update component styles",
        status: "queued",
        order: 3,
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

  describe("buildDetailedView", () => {
    it("should return null for non-existent session", () => {
      expect(buildDetailedView("nonexistent")).toBeNull();
    });

    it("should return detailed view with session info", () => {
      const view = buildDetailedView("s_show1");
      expect(view).not.toBeNull();
      expect(view!.id).toBe("s_show1");
      expect(view!.repo).toBe("owner/repo");
      expect(view!.goal).toBe("Add dark mode");
      expect(view!.status).toBe("building");
      expect(view!.workingBranch).toBe("sw/s_show1-add-dark-mode");
      expect(view!.planReady).toBe(true);
    });

    it("should count tasks correctly", () => {
      const view = buildDetailedView("s_show1")!;
      expect(view.tasksTotal).toBe(3);
      expect(view.tasksDone).toBe(1);
    });

    it("should return all tasks with status", () => {
      const view = buildDetailedView("s_show1")!;
      expect(view.tasks).toHaveLength(3);
      expect(view.tasks[0].status).toBe("done");
      expect(view.tasks[0].reviewVerdict).toBe("approve");
      expect(view.tasks[1].status).toBe("running");
      expect(view.tasks[2].status).toBe("queued");
    });

    it("should include recent messages", () => {
      const view = buildDetailedView("s_show1")!;
      expect(view.recentMessages.length).toBeGreaterThan(0);
      expect(view.recentMessages[0].role).toBe("system");
    });

    it("should count iterations", () => {
      const view = buildDetailedView("s_show1")!;
      expect(view.iterationCount).toBe(0);
    });

    it("should count iterations when present", () => {
      const db = getDb();
      db.insert(iterations)
        .values({
          id: "iter-1",
          sessionId: "s_show1",
          iterationNumber: 1,
          feedback: "Fix the colors",
          status: "done",
          createdAt: new Date(),
        })
        .run();

      const view = buildDetailedView("s_show1")!;
      expect(view.iterationCount).toBe(1);
    });
  });

  describe("formatDetailedView", () => {
    it("should show session header", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Session: s_show1");
    });

    it("should show session metadata", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Repo:     owner/repo");
      expect(output).toContain("Goal:     Add dark mode");
      expect(output).toContain("Status:   building");
      expect(output).toContain("Branch:   sw/s_show1-add-dark-mode");
      expect(output).toContain("Plan:     ready");
    });

    it("should show task progress bar", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Progress:");
      expect(output).toContain("1/3");
    });

    it("should show individual task statuses", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("task-001: Set up theme config [done]");
      expect(output).toContain("task-002: Create dark palette [running]");
      expect(output).toContain("task-003: Update components [queued]");
    });

    it("should show review info for reviewed tasks", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("review: approve, cycles: 1");
    });

    it("should show recent activity section", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Recent Activity");
      expect(output).toContain("[system]");
    });

    it("should show 'not finalized' when plan is not ready", () => {
      const db = getDb();
      db.insert(sessions)
        .values({
          id: "s_noplan",
          repo: "owner/repo2",
          goal: "Some goal",
          status: "planning",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const view = buildDetailedView("s_noplan")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Plan:     not finalized");
      expect(output).toContain("No tasks yet");
    });

    it("should show timing information", () => {
      const view = buildDetailedView("s_show1")!;
      const output = formatDetailedView(view);
      expect(output).toContain("Created:");
      expect(output).toContain("Updated:");
      expect(output).toContain("Elapsed:");
    });
  });
});
