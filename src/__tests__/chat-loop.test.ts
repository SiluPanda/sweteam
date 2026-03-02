import { describe, it, expect } from "vitest";
import { parseInput, getHelpText } from "../session/chat.js";

describe("session/chat — parseInput", () => {
  it("should parse @build", () => {
    expect(parseInput("@build")).toEqual({ type: "build" });
  });

  it("should parse @stop", () => {
    expect(parseInput("@stop")).toEqual({ type: "stop" });
  });

  it("should parse @help", () => {
    expect(parseInput("@help")).toEqual({ type: "help" });
  });

  it("should parse @plan", () => {
    expect(parseInput("@plan")).toEqual({ type: "plan" });
  });

  it("should parse @status", () => {
    expect(parseInput("@status")).toEqual({ type: "status" });
  });

  it("should parse @diff", () => {
    expect(parseInput("@diff")).toEqual({ type: "diff" });
  });

  it("should parse @pr", () => {
    expect(parseInput("@pr")).toEqual({ type: "pr" });
  });

  it("should parse @tasks", () => {
    expect(parseInput("@tasks")).toEqual({ type: "tasks" });
  });

  it("should parse @feedback with text", () => {
    expect(parseInput("@feedback Make it darker")).toEqual({
      type: "feedback",
      text: "Make it darker",
    });
  });

  it("should parse regular messages", () => {
    expect(parseInput("Hello, can you add tests?")).toEqual({
      type: "message",
      text: "Hello, can you add tests?",
    });
  });

  it("should trim whitespace", () => {
    expect(parseInput("  @build  ")).toEqual({ type: "build" });
  });
});

describe("session/chat — getHelpText", () => {
  it("should include all commands", () => {
    const help = getHelpText();
    expect(help).toContain("@build");
    expect(help).toContain("@status");
    expect(help).toContain("@plan");
    expect(help).toContain("@feedback");
    expect(help).toContain("@diff");
    expect(help).toContain("@pr");
    expect(help).toContain("@tasks");
    expect(help).toContain("@stop");
    expect(help).toContain("@help");
  });
});
