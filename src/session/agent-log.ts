import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "fs";
import { join } from "path";
import { SWETEAM_DIR } from "../db/client.js";

const LOG_DIR = join(SWETEAM_DIR, "logs");

export interface AgentEvent {
  type: "agent-start" | "output" | "agent-end" | "build-complete";
  id: string;
  role?: string;
  taskId?: string;
  title?: string;
  chunk?: string;
  success?: boolean;
  ts: number;
}

export function getLogPath(sessionId: string): string {
  mkdirSync(LOG_DIR, { recursive: true });
  return join(LOG_DIR, `${sessionId}.jsonl`);
}

export function clearLog(sessionId: string): void {
  writeFileSync(getLogPath(sessionId), "");
}

export function writeEvent(
  sessionId: string,
  event: Omit<AgentEvent, "ts">,
): void {
  const line = JSON.stringify({ ...event, ts: Date.now() }) + "\n";
  appendFileSync(getLogPath(sessionId), line);
}

export interface LogWatcher {
  stop(): void;
}

/**
 * Watch a session's agent log file for new events. Replays existing events
 * from the beginning, then polls for new content every 200ms.
 */
export function watchLog(
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
): LogWatcher {
  const logPath = getLogPath(sessionId);
  let offset = 0;
  let stopped = false;

  function poll() {
    if (stopped) return;
    try {
      if (!existsSync(logPath)) return;
      const stat = statSync(logPath);
      if (stat.size <= offset) return;

      const content = readFileSync(logPath, "utf-8");
      const newContent = content.slice(offset);
      offset = content.length;

      const lines = newContent.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          onEvent(JSON.parse(line));
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
