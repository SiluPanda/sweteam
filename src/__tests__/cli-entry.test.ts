import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("CLI entry point (src/index.ts)", () => {
  const indexContent = readFileSync(
    join(__dirname, "../index.ts"),
    "utf-8",
  );

  it("should have a shebang line", () => {
    expect(indexContent.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("should set program name to sweteam", () => {
    expect(indexContent).toContain('.name("sweteam")');
  });

  it("should set version", () => {
    expect(indexContent).toContain('.version("0.1.0")');
  });

  it("should register create command", () => {
    expect(indexContent).toContain('.command("create")');
  });

  it("should register list command", () => {
    expect(indexContent).toContain('.command("list")');
  });

  it("should register enter command", () => {
    expect(indexContent).toContain('.command("enter")');
  });

  it("should register stop command", () => {
    expect(indexContent).toContain('.command("stop")');
  });

  it("should register delete command", () => {
    expect(indexContent).toContain('.command("delete")');
  });

  it("should register init command", () => {
    expect(indexContent).toContain('.command("init")');
  });

  it("should call program.parse()", () => {
    expect(indexContent).toContain("program.parse()");
  });
});
