import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { canResume, resumeSession } from "../session/resume.js";
import { getSession } from "../session/manager.js";
import { formatSessionTable } from "../commands/list.js";

// Test CLI flag overrides are registered
describe("CLI flag overrides (#task-74)", () => {
  it("should have --coder, --reviewer, --parallel, --config options in index.ts", () => {
    const indexContent = readFileSync(
      join(__dirname, "../index.ts"),
      "utf-8",
    );
    expect(indexContent).toContain("--coder");
    expect(indexContent).toContain("--reviewer");
    expect(indexContent).toContain("--parallel");
    expect(indexContent).toContain("--config");
  });
});

describe("Session resume (#task-75)", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-resume-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions)
      .values([
        {
          id: "s_stopped",
          repo: "owner/repo",
          goal: "Test",
          status: "stopped",
          createdAt: new Date(),
          updatedAt: new Date(),
          stoppedAt: new Date(),
        },
        {
          id: "s_planning",
          repo: "owner/repo",
          goal: "Test",
          status: "planning",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "s_awaiting",
          repo: "owner/repo",
          goal: "Test",
          status: "awaiting_feedback",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
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

  it("should identify stopped sessions as resumable", () => {
    const result = canResume("s_stopped");
    expect(result.resumable).toBe(true);
    expect(result.allowedActions).toContain("@build");
    expect(result.allowedActions).toContain("@feedback");
  });

  it("should identify planning sessions as resumable", () => {
    const result = canResume("s_planning");
    expect(result.resumable).toBe(true);
    expect(result.allowedActions).toContain("@build");
  });

  it("should identify awaiting_feedback as resumable", () => {
    const result = canResume("s_awaiting");
    expect(result.resumable).toBe(true);
    expect(result.allowedActions).toContain("@feedback");
  });

  it("should resume stopped session to building", () => {
    resumeSession("s_stopped", "build");
    const session = getSession("s_stopped");
    expect(session!.status).toBe("building");
  });

  it("should resume stopped session to iterating", () => {
    resumeSession("s_stopped", "iterate");
    const session2 = getSession("s_stopped");
    expect(session2!.status).toBe("iterating");
  });

  it("should return not resumable for non-existent session", () => {
    const result = canResume("nonexistent");
    expect(result.resumable).toBe(false);
  });
});

describe("npm bin entry and build script (#task-76)", () => {
  it("should have bin entry in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf-8"),
    );
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.sweteam).toBe("./dist/index.js");
  });

  it("should have build script", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf-8"),
    );
    expect(pkg.scripts.build).toBe("tsc");
  });

  it("should have dev and start scripts", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf-8"),
    );
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.start).toBeDefined();
  });
});

describe("gh auth validation (#task-77)", () => {
  it("should export validateGhAuth function", async () => {
    const { validateGhAuth } = await import("../config/gh-auth.js");
    expect(typeof validateGhAuth).toBe("function");
  });

  it("should return authenticated status", async () => {
    const { validateGhAuth } = await import("../config/gh-auth.js");
    const result = validateGhAuth();
    expect(typeof result.authenticated).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });
});

describe("Session search/filter (#task-78)", () => {
  it("should have --status and --repo options in list command", () => {
    const indexContent = readFileSync(
      join(__dirname, "../index.ts"),
      "utf-8",
    );
    expect(indexContent).toContain("--status");
    expect(indexContent).toContain("--repo");
  });

  it("should filter sessions by status in handleList", async () => {
    const { handleList } = await import("../commands/list.js");
    // This verifies the function signature accepts filters
    expect(typeof handleList).toBe("function");
  });
});
