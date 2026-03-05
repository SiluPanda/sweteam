import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, messages } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Mock the git module to avoid real git operations
vi.mock("../git/git.js", () => ({
  resolveRepo: vi.fn((input: string) => `owner/${input}`),
  cloneOrLocateRepo: vi.fn(() => "/tmp/fake-repo"),
  createBranch: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue("main"),
  git: vi.fn(),
  deleteBranches: vi.fn(),
}));

// Mock the config loader
vi.mock("../config/loader.js", () => ({
  loadConfig: vi.fn(() => ({
    roles: { planner: "claude-code", coder: "claude-code", reviewer: "claude-code" },
    execution: { max_parallel: 3, max_review_cycles: 3, branch_prefix: "sw/" },
    git: { commit_style: "conventional", squash_on_merge: true },
    agents: {},
  })),
}));

import {
  createSession,
  getSession,
  listSessions,
  stopSession,
  deleteSession,
  addMessage,
  getMessages,
} from "../session/manager.js";

describe("session/manager", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-mgr-test-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "test.db");
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe("createSession", () => {
    it("should create a session and return session info", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Add dark theme" });

      expect(result.id).toMatch(/^s_/);
      expect(result.repo).toBe("owner/myrepo");
      expect(result.repoLocalPath).toBe("/tmp/fake-repo");
      expect(result.workingBranch).toMatch(/^sw\/s_.*-add-dark-theme$/);
    });

    it("should insert session into database", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Build feature" });

      const session = getSession(result.id);
      expect(session).not.toBeNull();
      expect(session!.repo).toBe("owner/myrepo");
      expect(session!.goal).toBe("Build feature");
      expect(session!.status).toBe("planning");
    });

    it("should insert a system message on creation", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Build feature" });

      const msgs = getMessages(result.id);
      expect(msgs.length).toBe(1);
      expect(msgs[0].role).toBe("system");
      expect(msgs[0].content).toContain("Session created for owner/myrepo");
    });

    it("should create session without goal", async () => {
      const result = await createSession({ repoInput: "myrepo" });

      expect(result.id).toMatch(/^s_/);
      expect(result.workingBranch).toMatch(/^sw\/s_[a-zA-Z0-9_-]+$/);
      const session = getSession(result.id);
      expect(session!.goal).toBe("");
    });
  });

  describe("getSession", () => {
    it("should return null for non-existent session", () => {
      expect(getSession("nonexistent")).toBeNull();
    });

    it("should return session when it exists", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Goal" });
      const session = getSession(result.id);

      expect(session).not.toBeNull();
      expect(session!.id).toBe(result.id);
    });
  });

  describe("listSessions", () => {
    it("should return empty array when no sessions", () => {
      expect(listSessions()).toEqual([]);
    });

    it("should return all sessions", async () => {
      await createSession({ repoInput: "repo1", goal: "Goal 1" });
      await createSession({ repoInput: "repo2", goal: "Goal 2" });

      const list = listSessions();
      expect(list.length).toBe(2);
    });
  });

  describe("stopSession", () => {
    it("should set status to stopped", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Goal" });
      stopSession(result.id);

      const session = getSession(result.id);
      expect(session!.status).toBe("stopped");
      expect(session!.stoppedAt).not.toBeNull();
    });

    it("should throw for non-existent session", () => {
      expect(() => stopSession("nonexistent")).toThrow("Session not found");
    });
  });

  describe("deleteSession", () => {
    it("should remove session from database", async () => {
      const result = await createSession({ repoInput: "myrepo", goal: "Goal" });
      deleteSession(result.id);

      expect(getSession(result.id)).toBeNull();
    });

    it("should throw for non-existent session", () => {
      expect(() => deleteSession("nonexistent")).toThrow("Session not found");
    });
  });

  describe("addMessage", () => {
    it("should add a message and return its id", async () => {
      const session = await createSession({ repoInput: "myrepo", goal: "Goal" });
      const msgId = addMessage(session.id, "user", "Hello", { phase: "planning" });

      expect(msgId).toBeTruthy();
      const msgs = getMessages(session.id);
      const userMsg = msgs.find((m) => m.id === msgId);
      expect(userMsg).toBeDefined();
      expect(userMsg!.role).toBe("user");
      expect(userMsg!.content).toBe("Hello");
    });
  });

  describe("getMessages", () => {
    it("should return messages in order", async () => {
      const session = await createSession({ repoInput: "myrepo", goal: "Goal" });
      addMessage(session.id, "user", "First");
      addMessage(session.id, "agent", "Second");

      const msgs = getMessages(session.id);
      // 1 system + 2 added = 3
      expect(msgs.length).toBe(3);
      expect(msgs[0].role).toBe("system");
      expect(msgs[1].content).toBe("First");
      expect(msgs[2].content).toBe("Second");
    });

    it("should respect limit parameter", async () => {
      const session = await createSession({ repoInput: "myrepo", goal: "Goal" });
      addMessage(session.id, "user", "Msg 1");
      addMessage(session.id, "user", "Msg 2");
      addMessage(session.id, "user", "Msg 3");

      const msgs = getMessages(session.id, 2);
      expect(msgs.length).toBe(2);
      expect(msgs[0].content).toBe("Msg 2");
      expect(msgs[1].content).toBe("Msg 3");
    });
  });
});
