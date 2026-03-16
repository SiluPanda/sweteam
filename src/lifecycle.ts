import { type ChildProcess, execSync } from 'child_process';
import { closeDb } from './db/client.js';

/** Track spawned child processes for cleanup on shutdown. */
const activeProcesses = new Map<ChildProcess, string | undefined>();

export function trackProcess(proc: ChildProcess, sessionId?: string): void {
  activeProcesses.set(proc, sessionId);
  proc.on('close', () => activeProcesses.delete(proc));
  proc.on('error', () => activeProcesses.delete(proc));
}

/** Check whether any tracked processes are still running for a session. */
export function hasActiveProcesses(sessionId: string): boolean {
  for (const [proc, sid] of activeProcesses) {
    if (sid === sessionId && !proc.killed) return true;
  }
  return false;
}

/** Kill processes belonging to a specific session, or all if no sessionId given. */
export function killSessionProcesses(sessionId: string): void {
  for (const [proc, sid] of activeProcesses) {
    if (sid === sessionId) {
      killProcess(proc);
    }
  }
  const timer = setTimeout(() => {
    for (const [proc, sid] of activeProcesses) {
      if (sid === sessionId) {
        forceKillProcess(proc);
      }
    }
  }, 2000);
  timer.unref(); // Don't keep event loop alive for this
}

/** Send a graceful termination signal (platform-aware). */
function killProcess(proc: ChildProcess): void {
  try {
    if (process.platform === 'win32') {
      if (proc.pid) {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      }
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // Process may have already exited
  }
}

/** Force-kill a process (platform-aware). */
function forceKillProcess(proc: ChildProcess): void {
  try {
    if (process.platform === 'win32') {
      if (proc.pid) {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      }
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // Already dead
  }
}

export function killAllProcesses(): void {
  for (const proc of activeProcesses.keys()) {
    killProcess(proc);
  }
  // Give processes a moment, then force-kill any remaining
  const timer = setTimeout(() => {
    for (const proc of activeProcesses.keys()) {
      forceKillProcess(proc);
    }
  }, 2000);
  timer.unref(); // Don't keep event loop alive for this
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
  const exitTimer = setTimeout(() => process.exit(0), 3000);
  exitTimer.unref(); // Don't keep event loop alive for this
}

let handlersInstalled = false;

export function installShutdownHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGHUP', () => handleShutdown('SIGHUP'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    killAllProcesses();
    try {
      closeDb();
    } catch (closeErr) {
      console.error('Failed to close database during crash handler:', closeErr);
    }
    process.exit(1);
  });
}
