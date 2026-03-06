import type { ChildProcess } from "child_process";
import { closeDb } from "./db/client.js";

/** Track spawned child processes for cleanup on shutdown. */
const activeProcesses = new Map<ChildProcess, string | undefined>();

export function trackProcess(proc: ChildProcess, sessionId?: string): void {
  activeProcesses.set(proc, sessionId);
  proc.on("close", () => activeProcesses.delete(proc));
  proc.on("error", () => activeProcesses.delete(proc));
}

/** Kill processes belonging to a specific session, or all if no sessionId given. */
export function killSessionProcesses(sessionId: string): void {
  for (const [proc, sid] of activeProcesses) {
    if (sid === sessionId) {
      try { proc.kill("SIGTERM"); } catch { /* already exited */ }
    }
  }
  setTimeout(() => {
    for (const [proc, sid] of activeProcesses) {
      if (sid === sessionId) {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }
    }
  }, 2000);
}

export function killAllProcesses(): void {
  for (const proc of activeProcesses.keys()) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
  }
  // Give processes a moment, then force-kill any remaining
  setTimeout(() => {
    for (const proc of activeProcesses.keys()) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }
  }, 2000);
}

let shuttingDown = false;

function handleShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  // Restore terminal state
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // May not be in raw mode
    }
  }

  console.log(`\nReceived ${signal}. Cleaning up...`);

  killAllProcesses();
  closeDb();

  // Delay must exceed the SIGKILL fallback (2000ms) to avoid orphaning processes
  setTimeout(() => process.exit(0), 3000);
}

export function installShutdownHandlers(): void {
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err.message);
    killAllProcesses();
    closeDb();
    process.exit(1);
  });
}
