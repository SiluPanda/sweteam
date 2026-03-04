import { describe, it, expect } from "vitest";
import { trackProcess, installShutdownHandlers } from "../lifecycle.js";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";

describe("integration — lifecycle module", () => {
  it("trackProcess should handle mock process events", () => {
    const mockProc = new EventEmitter() as unknown as ChildProcess;

    // Should not throw
    trackProcess(mockProc);

    // Simulate process close
    mockProc.emit("close", 0);
  });

  it("trackProcess should clean up on error", () => {
    const mockProc = new EventEmitter() as unknown as ChildProcess;
    trackProcess(mockProc);
    mockProc.emit("error", new Error("test error"));
  });

  it("installShutdownHandlers should not throw when called multiple times", () => {
    // Should be idempotent
    expect(() => installShutdownHandlers()).not.toThrow();
    expect(() => installShutdownHandlers()).not.toThrow();
  });
});
