import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { transition, validateTransition, type SessionStatus } from "../session/state-machine.js";
import { sessions } from "../db/schema.js";
import { nanoid } from "nanoid";

describe("integration — state machine transitions", () => {
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweteam-sm-"));
    dbPath = join(tmpDir, "test.db");
    // Initialize DB fresh
    closeDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestSession(status: SessionStatus): string {
    const db = getDb();
    const id = `s_${nanoid(8)}`;
    db.insert(sessions)
      .values({
        id,
        repo: "test/repo",
        goal: "test goal",
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    return id;
  }

  it("should allow planning → building transition", () => {
    const id = createTestSession("planning");
    expect(() => transition(id, "building")).not.toThrow();
  });

  it("should allow building → awaiting_feedback transition", () => {
    const id = createTestSession("building");
    expect(() => transition(id, "awaiting_feedback")).not.toThrow();
  });

  it("should allow awaiting_feedback → iterating transition", () => {
    const id = createTestSession("awaiting_feedback");
    expect(() => transition(id, "iterating")).not.toThrow();
  });

  it("should allow any state → stopped transition", () => {
    const states: SessionStatus[] = ["planning", "building", "awaiting_feedback", "iterating"];
    for (const state of states) {
      const id = createTestSession(state);
      expect(() => transition(id, "stopped")).not.toThrow();
    }
  });

  it("should reject invalid transitions", () => {
    expect(validateTransition("awaiting_feedback", "planning")).toBe(false);
    expect(validateTransition("planning", "awaiting_feedback")).toBe(false);
    expect(validateTransition("building", "building")).toBe(false);
    expect(validateTransition("stopped", "iterating")).toBe(true);
  });

  it("should validate all expected valid transitions", () => {
    expect(validateTransition("planning", "building")).toBe(true);
    expect(validateTransition("planning", "stopped")).toBe(true);
    expect(validateTransition("building", "awaiting_feedback")).toBe(true);
    expect(validateTransition("building", "planning")).toBe(true);
    expect(validateTransition("building", "stopped")).toBe(true);
    expect(validateTransition("awaiting_feedback", "building")).toBe(true);
    expect(validateTransition("awaiting_feedback", "iterating")).toBe(true);
    expect(validateTransition("awaiting_feedback", "stopped")).toBe(true);
    expect(validateTransition("iterating", "awaiting_feedback")).toBe(true);
    expect(validateTransition("iterating", "planning")).toBe(true);
    expect(validateTransition("iterating", "stopped")).toBe(true);
    expect(validateTransition("stopped", "planning")).toBe(true);
    expect(validateTransition("stopped", "building")).toBe(true);
  });

  it("should throw on transition for non-existent session", () => {
    expect(() => transition("nonexistent", "building")).toThrow();
  });

  it("should reject building → building self-transition", () => {
    const id = createTestSession("building");
    expect(() => transition(id, "building")).toThrow("Invalid transition");
  });

  it("should allow iterating → planning transition", () => {
    const id = createTestSession("iterating");
    expect(() => transition(id, "planning")).not.toThrow();
  });

  it("should allow stopped → planning transition", () => {
    const id = createTestSession("stopped");
    expect(() => transition(id, "planning")).not.toThrow();
  });
});
