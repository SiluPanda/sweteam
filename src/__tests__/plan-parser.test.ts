import { describe, it, expect } from "vitest";
import { parsePlan } from "../planner/plan-parser.js";

describe("planner/plan-parser — parsePlan", () => {
  it("should parse JSON array of tasks", () => {
    const input = JSON.stringify([
      {
        id: "task-001",
        title: "Add config",
        description: "Create config file",
        files_likely_touched: ["src/config.ts"],
        depends_on: [],
        acceptance_criteria: ["Config loads"],
      },
    ]);

    const result = parsePlan(input);
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].id).toBe("task-001");
    expect(result.tasks[0].title).toBe("Add config");
    expect(result.tasks[0].filesLikelyTouched).toEqual(["src/config.ts"]);
  });

  it("should parse JSON wrapped in code blocks", () => {
    const input = `Here's the plan:\n\`\`\`json\n${JSON.stringify({
      tasks: [
        {
          id: "task-001",
          title: "Setup",
          description: "Initial setup",
          files_likely_touched: [],
          depends_on: [],
          acceptance_criteria: ["Works"],
        },
      ],
    })}\n\`\`\``;

    const result = parsePlan(input);
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].title).toBe("Setup");
  });

  it("should handle { tasks: [...] } wrapper", () => {
    const input = JSON.stringify({
      tasks: [
        {
          id: "task-001",
          title: "Test",
          description: "A test",
          files_likely_touched: ["a.ts"],
          depends_on: [],
          acceptance_criteria: [],
        },
      ],
    });

    const result = parsePlan(input);
    expect(result.tasks.length).toBe(1);
  });

  it("should auto-generate IDs when missing", () => {
    const input = JSON.stringify([
      { title: "First", description: "First task" },
      { title: "Second", description: "Second task" },
    ]);

    const result = parsePlan(input);
    expect(result.tasks[0].id).toBe("task-001");
    expect(result.tasks[1].id).toBe("task-002");
  });

  it("should handle alternative key names", () => {
    const input = JSON.stringify([
      {
        id: "task-001",
        title: "Test",
        description: "Desc",
        files: ["file.ts"],
        dependencies: ["task-000"],
        criteria: ["Pass tests"],
      },
    ]);

    const result = parsePlan(input);
    expect(result.tasks[0].filesLikelyTouched).toEqual(["file.ts"]);
    expect(result.tasks[0].dependsOn).toEqual(["task-000"]);
    expect(result.tasks[0].acceptanceCriteria).toEqual(["Pass tests"]);
  });

  it("should parse markdown task sections", () => {
    const input = `### task-001: Add config module
Description: Create the configuration system

Files:
- src/config.ts
- src/config/loader.ts

Depends:
- (none)

Acceptance:
- Config loads from TOML

### task-002: Add CLI entry
Description: Wire up CLI

Files:
- src/index.ts

Depends:
- task-001`;

    const result = parsePlan(input);
    expect(result.tasks.length).toBe(2);
    expect(result.tasks[0].id).toBe("task-001");
    expect(result.tasks[0].title).toBe("Add config module");
    expect(result.tasks[1].id).toBe("task-002");
  });

  it("should strip markdown bold from task IDs (JSON)", () => {
    const input = JSON.stringify([
      { id: "**1**", title: "First", description: "D" },
      { id: "**2**", title: "Second", description: "D" },
    ]);

    const result = parsePlan(input);
    expect(result.tasks[0].id).toBe("1");
    expect(result.tasks[1].id).toBe("2");
  });

  it("should strip markdown bold from task IDs (table)", () => {
    const input = `
| ID | Title | Description |
|----|-------|-------------|
| **1** | Add dep | Install package |
| **2** | Add cache | Implement caching |`;

    const result = parsePlan(input);
    expect(result.tasks[0].id).toBe("1");
    expect(result.tasks[1].id).toBe("2");
  });

  it("should strip inline code from task IDs", () => {
    const input = JSON.stringify([
      { id: "`task-1`", title: "First", description: "D" },
    ]);

    const result = parsePlan(input);
    expect(result.tasks[0].id).toBe("task-1");
  });

  it("should return empty tasks for unparseable output", () => {
    const result = parsePlan("Just some random text with no structure");
    expect(result.tasks).toEqual([]);
    expect(result.raw).toBe("Just some random text with no structure");
  });

  it("should preserve raw output", () => {
    const input = JSON.stringify([{ title: "Test", description: "D" }]);
    const result = parsePlan(input);
    expect(result.raw).toBe(input);
  });
});
