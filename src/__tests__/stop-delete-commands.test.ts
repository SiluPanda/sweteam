import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, closeDb } from "../db/client.js";
import { sessions } from "../db/schema.js";

import { handleStop } from "../commands/stop.js";
import { handleDelete } from "../commands/delete.js";
import { getSession } from "../session/manager.js";

describe("commands/stop", () => {
  const tempDirs: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-stop-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    db.insert(sessions)
      .values({
        id: "s_stop1",
        repo: "owner/repo",
        goal: "Goal",
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    consoleSpy.mockRestore();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should stop a session", async () => {
    await handleStop("s_stop1");

    const session = getSession("s_stop1");
    expect(session!.status).toBe("stopped");
  });

  it("should print confirmation", async () => {
    await handleStop("s_stop1");

    expect(consoleSpy).toHaveBeenCalledWith("Session s_stop1 stopped.");
  });
});

describe("commands/delete", () => {
  const tempDirs: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sweteam-del-test-"));
    tempDirs.push(dir);
    const db = getDb(join(dir, "test.db"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    db.insert(sessions)
      .values({
        id: "s_del1",
        repo: "owner/repo",
        goal: "Goal",
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    consoleSpy.mockRestore();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("should delete a session", async () => {
    await handleDelete("s_del1");

    const session = getSession("s_del1");
    expect(session).toBeNull();
  });

  it("should print confirmation", async () => {
    await handleDelete("s_del1");

    expect(consoleSpy).toHaveBeenCalledWith("Session s_del1 deleted.");
  });
});
