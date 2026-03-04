import { describe, it, expect } from "vitest";
import { parseReviewResponse } from "../orchestrator/reviewer.js";

describe("integration — reviewer parse edge cases", () => {
  it("should parse valid JSON approval", () => {
    const result = parseReviewResponse(
      '{"verdict": "approve", "issues": [], "summary": "Looks good"}',
    );
    expect(result.verdict).toBe("approve");
    expect(result.issues).toEqual([]);
  });

  it("should parse valid JSON with code fence", () => {
    const input = `Here's my review:
\`\`\`json
{
  "verdict": "request_changes",
  "issues": [{"file": "src/foo.ts", "line": 42, "severity": "error", "message": "Missing null check"}],
  "summary": "Needs fixes"
}
\`\`\``;
    const result = parseReviewResponse(input);
    expect(result.verdict).toBe("request_changes");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].file).toBe("src/foo.ts");
  });

  it("should request_changes on completely invalid JSON", () => {
    const result = parseReviewResponse("This is not JSON at all, just text.");
    expect(result.verdict).toBe("request_changes");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("should request_changes on empty response", () => {
    const result = parseReviewResponse("");
    expect(result.verdict).toBe("request_changes");
  });

  it("should handle JSON with unknown verdict as request_changes", () => {
    const result = parseReviewResponse(
      '{"verdict": "maybe", "issues": [], "summary": "Unsure"}',
    );
    expect(result.verdict).toBe("request_changes");
  });

  it("should handle JSON with missing fields", () => {
    const result = parseReviewResponse('{"verdict": "approve"}');
    expect(result.verdict).toBe("approve");
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("should handle JSON with extra whitespace", () => {
    const result = parseReviewResponse(`

    {"verdict": "approve", "issues": [], "summary": "OK"}

    `);
    expect(result.verdict).toBe("approve");
  });

  it("should handle issues as non-array gracefully", () => {
    const result = parseReviewResponse(
      '{"verdict": "approve", "issues": "none", "summary": "Fine"}',
    );
    expect(result.verdict).toBe("approve");
    expect(result.issues).toEqual([]);
  });
});
