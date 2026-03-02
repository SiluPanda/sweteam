import { describe, it, expect } from "vitest";
import {
  generatePrBody,
  formatCompletionReport,
} from "../orchestrator/build-handler.js";

const mockTasks = [
  { id: "task-001", title: "Add config", status: "done" },
  { id: "task-002", title: "Add CLI", status: "done" },
  { id: "task-003", title: "Add tests", status: "failed" },
  { id: "task-004", title: "Add docs", status: "blocked" },
];

const mockResults = {
  completed: ["task-001", "task-002"],
  failed: ["task-003"],
  blocked: ["task-004"],
};

describe("orchestrator/build-handler — generatePrBody", () => {
  it("should include the goal", () => {
    const body = generatePrBody("Add dark theme", mockResults, mockTasks);
    expect(body).toContain("Add dark theme");
  });

  it("should list all tasks with status icons", () => {
    const body = generatePrBody("Goal", mockResults, mockTasks);
    expect(body).toContain("✓ task-001: Add config");
    expect(body).toContain("✓ task-002: Add CLI");
    expect(body).toContain("✗ task-003: Add tests");
    expect(body).toContain("⊘ task-004: Add docs");
  });

  it("should include summary counts", () => {
    const body = generatePrBody("Goal", mockResults, mockTasks);
    expect(body).toContain("2 completed, 1 failed, 1 blocked");
  });

  it("should list escalated tasks", () => {
    const body = generatePrBody("Goal", mockResults, mockTasks);
    expect(body).toContain("Escalated Tasks");
    expect(body).toContain("task-003: Add tests");
  });

  it("should not show escalated section when no failures", () => {
    const noFail = { completed: ["task-001"], failed: [], blocked: [] };
    const body = generatePrBody("Goal", noFail, mockTasks);
    expect(body).not.toContain("Escalated Tasks");
  });
});

describe("orchestrator/build-handler — formatCompletionReport", () => {
  it("should show build complete header", () => {
    const report = formatCompletionReport(mockResults, mockTasks);
    expect(report).toContain("Build complete.");
  });

  it("should show task statuses", () => {
    const report = formatCompletionReport(mockResults, mockTasks);
    expect(report).toContain("✓ task-001  Add config");
    expect(report).toContain("⚠ task-003  Add tests");
    expect(report).toContain("⊘ task-004  Add docs");
  });

  it("should show PR URL when provided", () => {
    const report = formatCompletionReport(
      mockResults,
      mockTasks,
      "https://github.com/owner/repo/pull/42",
    );
    expect(report).toContain("PR: https://github.com/owner/repo/pull/42");
  });

  it("should prompt for feedback", () => {
    const report = formatCompletionReport(mockResults, mockTasks);
    expect(report).toContain("@feedback");
  });
});
