import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";

vi.mock("../git/git.js", () => ({
  resolveRepo: vi.fn((input: string) => `owner/${input}`),
  cloneOrLocateRepo: vi.fn(() => "/tmp/fake-repo"),
  createBranch: vi.fn(),
}));

vi.mock("../config/loader.js", () => ({
  loadConfig: vi.fn(() => ({
    roles: { planner: "claude-code", coder: "claude-code", reviewer: "claude-code" },
    execution: { max_parallel: 3, max_review_cycles: 3, branch_prefix: "sw/" },
    git: { commit_style: "conventional", squash_on_merge: true },
    agents: {},
  })),
}));

import { handleCreate } from "../commands/create.js";
import { getSession, listSessions } from "../session/manager.js";

describe("commands/create", () => {
  const tempDirs: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-create-test-"));
    tempDirs.push(dir);
    getDb(join(dir, "test.db"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    closeDb();
    consoleSpy.mockRestore();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should create a session and log info", async () => {
    await handleCreate("myrepo", "Add dark theme");

    const sessions = listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].repo).toBe("owner/myrepo");
    expect(sessions[0].goal).toBe("Add dark theme");
    expect(sessions[0].status).toBe("planning");
  });

  it("should print session ID to console", async () => {
    await handleCreate("myrepo", "Build feature");

    const calls = consoleSpy.mock.calls.flat().join("\n");
    expect(calls).toContain("Session created");
    expect(calls).toContain("ID:");
    expect(calls).toContain("Repo:");
    expect(calls).toContain("Branch:");
  });

  it("should create session with correct repo", async () => {
    await handleCreate("testrepo", "Fix bugs");

    const sessions = listSessions();
    expect(sessions[0].repo).toBe("owner/testrepo");
  });
});
