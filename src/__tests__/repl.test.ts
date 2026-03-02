import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { parseReplInput, completer } from "../repl/repl.js";

describe("repl", () => {
  describe("parseReplInput", () => {
    it("should return empty command for blank input", () => {
      expect(parseReplInput("")).toEqual({ command: "", args: [] });
      expect(parseReplInput("   ")).toEqual({ command: "", args: [] });
    });

    it("should parse command with no args", () => {
      expect(parseReplInput("/list")).toEqual({ command: "/list", args: [] });
      expect(parseReplInput("/help")).toEqual({ command: "/help", args: [] });
      expect(parseReplInput("/exit")).toEqual({ command: "/exit", args: [] });
    });

    it("should parse command with single arg", () => {
      expect(parseReplInput("/enter s_abc123")).toEqual({
        command: "/enter",
        args: ["s_abc123"],
      });
    });

    it("should parse command with multiple args", () => {
      expect(parseReplInput("/create myrepo add a new feature")).toEqual({
        command: "/create",
        args: ["myrepo", "add", "a", "new", "feature"],
      });
    });

    it("should trim leading/trailing whitespace", () => {
      expect(parseReplInput("  /list  ")).toEqual({ command: "/list", args: [] });
    });

    it("should handle multiple spaces between args", () => {
      expect(parseReplInput("/enter   s_abc123")).toEqual({
        command: "/enter",
        args: ["s_abc123"],
      });
    });
  });

  describe("completer", () => {
    it("should return no completions for non-slash input", () => {
      const [hits] = completer("hello");
      expect(hits).toEqual([]);
    });

    it("should complete partial commands", () => {
      const [hits, partial] = completer("/li");
      expect(hits).toContain("/list");
      expect(partial).toBe("/li");
    });

    it("should complete /e to /enter and /exit", () => {
      const [hits] = completer("/e");
      expect(hits).toContain("/enter");
      expect(hits).toContain("/exit");
    });

    it("should return all commands for bare /", () => {
      const [hits] = completer("/");
      expect(hits.length).toBeGreaterThanOrEqual(9);
      expect(hits).toContain("/list");
      expect(hits).toContain("/create");
      expect(hits).toContain("/help");
      expect(hits).toContain("/exit");
    });

    it("should complete session IDs for /enter", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "sweteam-repl-test-"));
      try {
        const db = getDb(join(tempDir, "test.db"));
        db.insert(sessions)
          .values({
            id: "s_abc123",
            repo: "owner/repo",
            goal: "Goal",
            status: "planning",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run();
        db.insert(sessions)
          .values({
            id: "s_abc456",
            repo: "owner/repo2",
            goal: "Goal 2",
            status: "building",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run();

        const [hits, partial] = completer("/enter s_abc");
        expect(partial).toBe("s_abc");
        expect(hits).toContain("s_abc123");
        expect(hits).toContain("s_abc456");
      } finally {
        closeDb();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete session IDs for /show", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "sweteam-repl-test-"));
      try {
        const db = getDb(join(tempDir, "test.db"));
        db.insert(sessions)
          .values({
            id: "s_xyz",
            repo: "owner/repo",
            goal: "Goal",
            status: "planning",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run();

        const [hits] = completer("/show s_");
        expect(hits).toContain("s_xyz");
      } finally {
        closeDb();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not complete session IDs for /list", () => {
      const [hits] = completer("/list s_");
      expect(hits).toEqual([]);
    });
  });
});
