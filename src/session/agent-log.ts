import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { SWETEAM_DIR } from '../db/client.js';

const LOG_DIR = join(SWETEAM_DIR, 'logs');

export interface AgentEvent {
  type:
    | 'agent-start'
    | 'output'
    | 'agent-end'
    | 'build-complete'
    | 'phase-complete'
    | 'input-needed'
    | 'input-response';
  id: string;
  role?: string;
  taskId?: string;
  title?: string;
  chunk?: string;
  success?: boolean;
  promptText?: string;
  requestId?: string;
  response?: string;
  ts: number;
}

export function getLogPath(sessionId: string): string {
  mkdirSync(LOG_DIR, { recursive: true });
  return join(LOG_DIR, `${sessionId}.jsonl`);
}

export function clearLog(sessionId: string): void {
  writeFileSync(getLogPath(sessionId), '');
}

export function writeEvent(sessionId: string, event: Omit<AgentEvent, 'ts'>): void {
  try {
    const line = JSON.stringify({ ...event, ts: Date.now() }) + '\n';
    appendFileSync(getLogPath(sessionId), line);
  } catch (err) {
    console.error(`Warning: failed to write agent event for session ${sessionId}:`, err);
  }
}

export interface LogWatcher {
  stop(): void;
}

/**
 * Watch a session's agent log file for new events. Replays existing events
 * from the beginning, then polls for new content every 200ms.
 */
/**
 * Check whether a session's log file has recent activity, indicating a build
 * is actively running (not a stale leftover from a crashed build).
 */
export function isLogActive(sessionId: string, staleThresholdMs: number = 60_000): boolean {
  const logPath = getLogPath(sessionId);
  if (!existsSync(logPath)) return false;

  try {
    const content = readFileSync(logPath, 'utf-8').trim();
    if (!content) return false;

    // Check the last event's timestamp
    const lines = content.split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const lastEvent = JSON.parse(lastLine) as AgentEvent;

    // If the last event is build-complete or phase-complete, the operation is done
    if (lastEvent.type === 'build-complete' || lastEvent.type === 'phase-complete') return false;

    // If the last event was written recently, the build is likely still active
    const age = Date.now() - lastEvent.ts;
    return age < staleThresholdMs;
  } catch {
    return false;
  }
}

export function watchLog(sessionId: string, onEvent: (event: AgentEvent) => void): LogWatcher {
  const logPath = getLogPath(sessionId);
  let offset = 0;
  let stopped = false;

  function poll() {
    if (stopped) return;
    try {
      if (!existsSync(logPath)) return;
      const stat = statSync(logPath);
      if (stat.size < offset) {
        // File was truncated (e.g. clearLog), reset offset to read from start
        offset = 0;
      }
      if (stat.size <= offset) return;

      const content = readFileSync(logPath, 'utf-8');
      const newContent = content.slice(offset);
      offset = content.length;

      const lines = newContent.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          try {
            onEvent(parsed);
          } catch (err) {
            console.error('watchLog onEvent error:', err);
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file access error, retry next poll
    }
  }

  // Initial read — replay existing events
  poll();

  // Poll for new content
  const timer = setInterval(poll, 200);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Wait for an `input-response` event matching the given requestId.
 * Polls the log file every 200ms. Times out after `timeoutMs` (default 5 min).
 */
export function waitForResponse(
  sessionId: string,
  requestId: string,
  timeoutMs: number = 5 * 60 * 1000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let resolved = false;

    const watcher = watchLog(sessionId, (event) => {
      if (resolved) return;
      if (event.type === 'input-response' && event.requestId === requestId) {
        resolved = true;
        watcher.stop();
        resolve(event.response ?? null);
      }
    });

    // Timeout check
    const timer = setInterval(() => {
      if (resolved) {
        clearInterval(timer);
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        resolved = true;
        watcher.stop();
        resolve(null);
      }
    }, 1000);
  });
}
