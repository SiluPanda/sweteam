import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions, tasks as tasksTable, iterations } from "../db/schema.js";
import { runTests, parseTestFailures } from "../orchestrator/test-runner.js";
import { getSessionCost, formatCostSummary } from "../session/cost-tracker.js";
import { exportSessionMarkdown } from "../session/export.js";

describe("Test runner integration (#task-79)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweteam-testrun-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should skip tests when no test command detected", () => {
    // Mock getDb for addMessage
    const dir = mkdtempSync(join(tmpdir(), "sweteam-testrun-db-"));
    const db = getDb(join(dir, "test.db"));
    db.insert(sessions).values({
      id: "s_tr",
      repo: "r",
      goal: "g",
      status: "building",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    const result = runTests(tmpDir, "s_tr");
    expect(result.passed).toBe(true);
    expect(result.output).toContain("No test command detected");

    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should detect npm test command", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );

    // We can't actually run tests in a temp dir, but verify detection logic
    const dir = mkdtempSync(join(tmpdir(), "sweteam-testrun-db2-"));
    const db = getDb(join(dir, "test.db"));
    db.insert(sessions).values({
      id: "s_tr2",
      repo: "r",
      goal: "g",
      status: "building",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    // This will fail because vitest isn't installed in tmpDir, but it proves detection works
    const result = runTests(tmpDir, "s_tr2");
    expect(result.command).toBe("npm test");

    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should parse test failures from output", () => {
    const output = "FAIL src/test.ts\nError: Expected 1 to be 2";
    const failures = parseTestFailures(output);
    expect(failures.length).toBeGreaterThan(0);
  });
});

describe("Cost tracking (#task-80)", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-cost-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions).values({
      id: "s_cost",
      repo: "owner/repo",
      goal: "Test",
      status: "awaiting_feedback",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    const now = new Date();
    db.insert(tasksTable).values([
      { id: "t-1", sessionId: "s_cost", title: "Task 1", description: "D1", status: "done", reviewCycles: 1, order: 1, createdAt: now, updatedAt: now },
      { id: "t-2", sessionId: "s_cost", title: "Task 2", description: "D2", status: "done", reviewCycles: 2, order: 2, createdAt: now, updatedAt: now },
    ]).run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should calculate total invocations", () => {
    const cost = getSessionCost("s_cost");
    // t-1: 1 coder + 1 review = 2, t-2: 1 coder + 2 review = 3
    expect(cost.totalInvocations).toBe(5);
  });

  it("should include task breakdown", () => {
    const cost = getSessionCost("s_cost");
    expect(cost.taskBreakdown.length).toBe(2);
    expect(cost.taskBreakdown[0].reviewCycles).toBe(1);
    expect(cost.taskBreakdown[1].reviewCycles).toBe(2);
  });

  it("should format cost summary", () => {
    const cost = getSessionCost("s_cost");
    const output = formatCostSummary(cost);
    expect(output).toContain("Cost Summary");
    expect(output).toContain("Total agent invocations: 5");
    expect(output).toContain("Task 1");
    expect(output).toContain("Task 2");
  });
});

describe("Export session as markdown (#task-81)", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-export-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));

    db.insert(sessions).values({
      id: "s_export",
      repo: "owner/repo",
      goal: "Add dark theme",
      status: "awaiting_feedback",
      planJson: JSON.stringify({ tasks: [{ id: "t-1", title: "Config", description: "Add config" }] }),
      prUrl: "https://github.com/owner/repo/pull/42",
      prNumber: 42,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();

    const now = new Date();
    db.insert(tasksTable).values({
      id: "t-1", sessionId: "s_export", title: "Config",
      description: "Add config", status: "done",
      reviewVerdict: "approve", reviewCycles: 1,
      diffPatch: "+export const theme = {};",
      order: 1, createdAt: now, updatedAt: now,
    }).run();

    db.insert(iterations).values({
      id: "iter-1", sessionId: "s_export", iterationNumber: 1,
      feedback: "Make it darker", status: "done", createdAt: now,
    }).run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should generate markdown with session info", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("# Session Report: s_export");
    expect(md).toContain("owner/repo");
    expect(md).toContain("Add dark theme");
  });

  it("should include plan", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("## Plan");
    expect(md).toContain("Config");
  });

  it("should include tasks table", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("## Tasks");
    expect(md).toContain("| t-1 |");
    expect(md).toContain("approve");
  });

  it("should include diffs", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("## Diffs");
    expect(md).toContain("export const theme");
  });

  it("should include iterations", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("## Iterations");
    expect(md).toContain("Make it darker");
  });

  it("should include PR link", () => {
    const md = exportSessionMarkdown("s_export");
    expect(md).toContain("[#42](https://github.com/owner/repo/pull/42)");
  });

  it("should handle non-existent session", () => {
    const md = exportSessionMarkdown("nonexistent");
    expect(md).toContain("Session not found");
  });
});
