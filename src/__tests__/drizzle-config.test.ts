import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";

describe("drizzle.config.ts", () => {
  it("should exist at project root", () => {
    const configPath = resolve(
      import.meta.dirname,
      "../../drizzle.config.ts",
    );
    expect(existsSync(configPath)).toBe(true);
  });

  it("should export a valid config", async () => {
    const config = await import("../../drizzle.config.js");
    const def = config.default;
    expect(def).toBeDefined();
    expect(def.dialect).toBe("sqlite");
    expect(def.schema).toBe("./src/db/schema.ts");
    expect(def.out).toBe("./drizzle/migrations");
  });
});
