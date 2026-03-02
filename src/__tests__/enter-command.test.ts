import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, messages } from "../db/schema.js";

import { buildSessionSummary, formatSummary } from "../commands/enter.js";

describe("commands/enter", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-enter-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values({
        id: "s_test1",
        repo: "owner/repo",
        goal: "Add feature X",
        status: "planning",
        workingBranch: "sw/s_test1-add-feature-x",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(messages)
      .values({
        id: "msg-1",
        sessionId: "s_test1",
        role: "system",
        content: "Session created for owner/repo",
        createdAt: new Date(),
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

  describe("buildSessionSummary", () => {
    it("should return null for non-existent session", () => {
      expect(buildSessionSummary("nonexistent")).toBeNull();
    });

    it("should return summary with session info", () => {
      const summary = buildSessionSummary("s_test1");
      expect(summary).not.toBeNull();
      expect(summary!.id).toBe("s_test1");
      expect(summary!.repo).toBe("owner/repo");
      expect(summary!.goal).toBe("Add feature X");
      expect(summary!.status).toBe("planning");
    });

    it("should include recent messages", () => {
      const summary = buildSessionSummary("s_test1");
      expect(summary!.recentMessages.length).toBe(1);
      expect(summary!.recentMessages[0].role).toBe("system");
    });

    it("should count tasks correctly", () => {
      const summary = buildSessionSummary("s_test1");
      expect(summary!.tasksTotal).toBe(0);
      expect(summary!.tasksDone).toBe(0);
    });
  });

  describe("formatSummary", () => {
    it("should format summary with all fields", () => {
      const summary = buildSessionSummary("s_test1")!;
      const output = formatSummary(summary);

      expect(output).toContain("Session: s_test1");
      expect(output).toContain("Repo:   owner/repo");
      expect(output).toContain("Goal:   Add feature X");
      expect(output).toContain("Status: planning");
      expect(output).toContain("Recent messages:");
    });

    it("should show PR URL when available", () => {
      const summary = buildSessionSummary("s_test1")!;
      summary.prUrl = "https://github.com/owner/repo/pull/42";
      const output = formatSummary(summary);

      expect(output).toContain("PR:     https://github.com/owner/repo/pull/42");
    });

    it("should truncate long messages", () => {
      const summary = buildSessionSummary("s_test1")!;
      summary.recentMessages = [
        {
          role: "agent",
          content: "A".repeat(100),
          createdAt: new Date(),
        },
      ];
      const output = formatSummary(summary);
      expect(output).toContain("...");
    });
  });
});
