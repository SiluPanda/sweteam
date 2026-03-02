import { describe, it, expect } from "vitest";
import {
  buildReviewerPrompt,
  parseReviewResponse,
} from "../orchestrator/reviewer.js";
import type { TaskRecord } from "../orchestrator/task-runner.js";

const mockTask: TaskRecord = {
  id: "task-001",
  sessionId: "s_test",
  title: "Add ThemeConfig",
  description: "Create a theme configuration module",
  filesLikelyTouched: JSON.stringify(["src/theme/config.ts"]),
  acceptanceCriteria: JSON.stringify(["ThemeConfig type exported", "Tests pass"]),
  dependsOn: null,
  branchName: "sw/task-001-add-theme",
  status: "reviewing",
};

describe("orchestrator/reviewer — buildReviewerPrompt", () => {
  it("should include task title and description", () => {
    const prompt = buildReviewerPrompt(mockTask, "diff content");
    expect(prompt).toContain("Add ThemeConfig");
    expect(prompt).toContain("Create a theme configuration module");
  });

  it("should include acceptance criteria", () => {
    const prompt = buildReviewerPrompt(mockTask, "diff content");
    expect(prompt).toContain("- ThemeConfig type exported");
    expect(prompt).toContain("- Tests pass");
  });

  it("should include the diff", () => {
    const prompt = buildReviewerPrompt(mockTask, "+export const theme = {};");
    expect(prompt).toContain("+export const theme = {};");
  });

  it("should request JSON response format", () => {
    const prompt = buildReviewerPrompt(mockTask, "diff");
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"issues"');
  });
});

describe("orchestrator/reviewer — parseReviewResponse", () => {
  it("should parse approve verdict", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        verdict: "approve",
        issues: [],
        summary: "Looks good",
      }),
    );
    expect(result.verdict).toBe("approve");
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe("Looks good");
  });

  it("should parse request_changes verdict", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        verdict: "request_changes",
        issues: [
          { file: "src/a.ts", line: 10, severity: "error", message: "Missing type" },
        ],
        summary: "Needs fixes",
      }),
    );
    expect(result.verdict).toBe("request_changes");
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].message).toBe("Missing type");
  });

  it("should parse JSON wrapped in code blocks", () => {
    const result = parseReviewResponse(
      '```json\n{"verdict": "approve", "issues": [], "summary": "OK"}\n```',
    );
    expect(result.verdict).toBe("approve");
  });

  it("should auto-approve on unparseable response", () => {
    const result = parseReviewResponse("This is not JSON at all");
    expect(result.verdict).toBe("approve");
    expect(result.summary).toContain("auto-approving");
  });
});
