import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  validateTransition,
  transition,
} from "../session/state-machine.js";
import { getDb, closeDb } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { eq } from "drizzle-orm";

describe("session/state-machine — validateTransition", () => {
  it("should allow planning -> building", () => {
    expect(validateTransition("planning", "building")).toBe(true);
  });

  it("should allow planning -> stopped", () => {
    expect(validateTransition("planning", "stopped")).toBe(true);
  });

  it("should allow building -> awaiting_feedback", () => {
    expect(validateTransition("building", "awaiting_feedback")).toBe(true);
  });

  it("should allow building -> stopped", () => {
    expect(validateTransition("building", "stopped")).toBe(true);
  });

  it("should allow awaiting_feedback -> iterating", () => {
    expect(validateTransition("awaiting_feedback", "iterating")).toBe(true);
  });

  it("should allow iterating -> awaiting_feedback", () => {
    expect(validateTransition("iterating", "awaiting_feedback")).toBe(true);
  });

  it("should allow stopped -> building", () => {
    expect(validateTransition("stopped", "building")).toBe(true);
  });

  it("should allow stopped -> iterating", () => {
    expect(validateTransition("stopped", "iterating")).toBe(true);
  });

  it("should reject planning -> awaiting_feedback", () => {
    expect(validateTransition("planning", "awaiting_feedback")).toBe(false);
  });

  it("should allow building -> planning (retry after failure)", () => {
    expect(validateTransition("building", "planning")).toBe(true);
  });

  it("should allow building -> building (retry)", () => {
    expect(validateTransition("building", "building")).toBe(true);
  });

  it("should reject awaiting_feedback -> building", () => {
    expect(validateTransition("awaiting_feedback", "building")).toBe(false);
  });
});

describe("session/state-machine — transition", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-sm-test-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "test.db");

    // Initialize the singleton with our test db
    const db = getDb(dbPath);

    // Insert a test session in planning status
    db.insert(sessions)
      .values({
        id: "test-session-1",
        repo: "owner/repo",
        goal: "test goal",
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
  });

  it("should transition from planning to building", () => {
    transition("test-session-1", "building");

    const db = getDb();
    const rows = db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, "test-session-1"))
      .all();

    expect(rows[0].status).toBe("building");
  });

  it("should set stoppedAt when transitioning to stopped", () => {
    transition("test-session-1", "stopped");

    const db = getDb();
    const rows = db
      .select({ status: sessions.status, stoppedAt: sessions.stoppedAt })
      .from(sessions)
      .where(eq(sessions.id, "test-session-1"))
      .all();

    expect(rows[0].status).toBe("stopped");
    expect(rows[0].stoppedAt).not.toBeNull();
  });

  it("should throw for non-existent session", () => {
    expect(() => transition("nonexistent", "building")).toThrow(
      "Session not found",
    );
  });

  it("should throw for invalid transition", () => {
    expect(() =>
      transition("test-session-1", "awaiting_feedback"),
    ).toThrow("Invalid transition");
  });
});
