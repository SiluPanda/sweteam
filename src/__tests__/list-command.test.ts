import { describe, it, expect } from "vitest";
import { formatSessionTable } from "../commands/list.js";

describe("commands/list — formatSessionTable", () => {
  it("should show empty message when no sessions", () => {
    const output = formatSessionTable([]);
    expect(output).toContain("No sessions found");
  });

  it("should render a table with sessions", () => {
    const sessions = [
      {
        id: "s_abc12345",
        repo: "owner/myrepo",
        goal: "Add dark theme",
        status: "building",
        prUrl: null,
        prNumber: null,
      },
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain("sweteam Sessions");
    expect(output).toContain("s_abc12345");
    expect(output).toContain("owner/myrepo");
    expect(output).toContain("Add dark theme");
    expect(output).toContain("building");
  });

  it("should truncate long goals", () => {
    const sessions = [
      {
        id: "s_xyz",
        repo: "owner/repo",
        goal: "This is a very long goal that should be truncated properly",
        status: "planning",
        prUrl: null,
        prNumber: null,
      },
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain("…");
  });

  it("should show PR number when available", () => {
    const sessions = [
      {
        id: "s_pr1",
        repo: "owner/repo",
        goal: "Fix bug",
        status: "awaiting_feedback",
        prUrl: "https://github.com/owner/repo/pull/42",
        prNumber: 42,
      },
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain("PR #42");
  });

  it("should handle multiple sessions", () => {
    const sessions = [
      { id: "s_1", repo: "a/b", goal: "Goal 1", status: "planning", prUrl: null, prNumber: null },
      { id: "s_2", repo: "c/d", goal: "Goal 2", status: "stopped", prUrl: null, prNumber: null },
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain("s_1");
    expect(output).toContain("s_2");
  });
});
