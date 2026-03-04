import type { ChildProcess } from "child_process";
import { closeDb } from "./db/client.js";

/** Track spawned child processes for cleanup on shutdown. */
const activeProcesses = new Set<ChildProcess>();

export function trackProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);
  proc.on("close", () => activeProcesses.delete(proc));
  proc.on("error", () => activeProcesses.delete(proc));
}

function killAllProcesses(): void {
  for (const proc of activeProcesses) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
  }
  // Give processes a moment, then force-kill any remaining
  setTimeout(() => {
    for (const proc of activeProcesses) {
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

  // Use a short delay to allow cleanup, then exit
  setTimeout(() => process.exit(0), 500);
}

export function installShutdownHandlers(): void {
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err.message);
    closeDb();
    process.exit(1);
  });
}
