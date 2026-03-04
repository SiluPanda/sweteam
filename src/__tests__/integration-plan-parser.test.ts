import { describe, it, expect } from "vitest";
import { parsePlan } from "../planner/plan-parser.js";

describe("integration — plan parser edge cases", () => {
  it("should handle empty input", () => {
    const result = parsePlan("");
    expect(result.tasks).toHaveLength(0);
  });

  it("should handle input with no tasks", () => {
    const result = parsePlan("Here is some text without any task structure.");
    expect(result.tasks).toHaveLength(0);
  });

  it("should handle JSON wrapped in markdown code fences", () => {
    const input = `Here is the plan:

\`\`\`json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Add auth module",
      "description": "Create authentication middleware",
      "files_likely_touched": ["src/auth.ts"],
      "depends_on": [],
      "acceptance_criteria": ["JWT validation works"]
    }
  ]
}
\`\`\``;

    const result = parsePlan(input);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Add auth module");
    expect(result.tasks[0].filesLikelyTouched).toEqual(["src/auth.ts"]);
  });

  it("should handle JSON array without wrapper object", () => {
    const input = `[
      {
        "id": "task-001",
        "title": "First task",
        "description": "Do something",
        "files_likely_touched": [],
        "depends_on": [],
        "acceptance_criteria": []
      },
      {
        "id": "task-002",
        "title": "Second task",
        "description": "Do something else",
        "files_likely_touched": [],
        "depends_on": ["task-001"],
        "acceptance_criteria": []
      }
    ]`;

    const result = parsePlan(input);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[1].dependsOn).toEqual(["task-001"]);
  });

  it("should handle task IDs with special characters from LLM", () => {
    const input = JSON.stringify({
      tasks: [
        {
          id: "task_001",
          title: "Task with underscores",
          description: "Test",
          files_likely_touched: [],
          depends_on: [],
          acceptance_criteria: [],
        },
      ],
    });

    const result = parsePlan(input);
    expect(result.tasks[0].id).toBe("task_001");
  });

  it("should generate IDs when none provided", () => {
    const input = JSON.stringify({
      tasks: [
        {
          title: "No ID task",
          description: "Missing id field",
          files_likely_touched: [],
          depends_on: [],
          acceptance_criteria: [],
        },
      ],
    });

    const result = parsePlan(input);
    expect(result.tasks[0].id).toMatch(/^task-001$/);
  });

  it("should handle Unicode in task titles", () => {
    const input = JSON.stringify({
      tasks: [
        {
          id: "task-001",
          title: "Add i18n support 🌍 für Deutsch",
          description: "Internationalization with émojis and àccents",
          files_likely_touched: ["src/i18n.ts"],
          depends_on: [],
          acceptance_criteria: ["Translations load correctly"],
        },
      ],
    });

    const result = parsePlan(input);
    expect(result.tasks[0].title).toContain("🌍");
    expect(result.tasks[0].description).toContain("émojis");
  });

  it("should handle very large task lists", () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({
      id: `task-${String(i + 1).padStart(3, "0")}`,
      title: `Task ${i + 1}`,
      description: `Description for task ${i + 1}`,
      files_likely_touched: [`src/file${i + 1}.ts`],
      depends_on: i > 0 ? [`task-${String(i).padStart(3, "0")}`] : [],
      acceptance_criteria: [`Criterion ${i + 1}`],
    }));

    const result = parsePlan(JSON.stringify({ tasks }));
    expect(result.tasks).toHaveLength(50);
    expect(result.tasks[49].dependsOn).toEqual(["task-049"]);
  });

  it("should handle markdown task format", () => {
    const input = `### task-001: Set up database schema

Create the SQLite schema for storing user data.

**Files:** src/db/schema.ts, src/db/migrations/001.sql
**Depends on:** none
**Acceptance criteria:**
- Tables are created
- Foreign keys work

### task-002: Add user API

Build the REST endpoints.

**Files:** src/api/users.ts
**Depends on:** task-001
**Acceptance criteria:**
- CRUD operations work`;

    const result = parsePlan(input);
    expect(result.tasks.length).toBeGreaterThanOrEqual(2);
    expect(result.tasks[0].id).toBe("task-001");
  });

  it("should handle JSON with extra fields gracefully", () => {
    const input = JSON.stringify({
      tasks: [
        {
          id: "task-001",
          title: "Test",
          description: "Test desc",
          files_likely_touched: [],
          depends_on: [],
          acceptance_criteria: [],
          extra_field: "should be ignored",
          priority: "high",
        },
      ],
    });

    const result = parsePlan(input);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Test");
  });
});
