import { existsSync } from "fs";
import { listSessions } from "../session/manager.js";
import { renderBanner, type RecentSession } from "../ui/banner.js";
import { promptLine } from "../ui/prompt.js";
import {
  createSessionHandlers,
  handleSessionCommand,
  type SessionHandlers,
} from "../session/interactive.js";
import { getStatusDisplay } from "../session/in-session-commands.js";
import { watchLog, getLogPath, type AgentEvent } from "../session/agent-log.js";
import { AgentPanel } from "../ui/agent-panel.js";

// ── Active session state ────────────────────────────────────────────

interface ActiveSession {
  id: string;
  repo: string;
  repoPath: string;
  handlers: SessionHandlers;
}

let activeSession: ActiveSession | null = null;

// ── Commands & completions ──────────────────────────────────────────

const COMMANDS = [
  "/list",
  "/create",
  "/enter",
  "/show",
  "/stop",
  "/delete",
  "/init",
  "/help",
  "/exit",
] as const;

const SESSION_ID_COMMANDS = new Set(["/enter", "/show", "/stop", "/delete"]);

const HELP_TEXT_ROOT = `Commands:
  /create [repo]          Create a new session (defaults to current directory)
  /list                   List all sessions
  /enter <session_id>     Re-enter an existing session
  /show <session_id>      Show detailed session view
  /stop <session_id>      Stop a session
  /delete <session_id>    Delete a session
  /init                   Auto-discover CLIs and generate config
  /help                   Show this help
  /exit                   Quit`;

const HELP_TEXT_SESSION = `Session commands (@ prefix):
  @build      — Finalize plan and start autonomous build
  @status     — Show current task progress
  @plan       — Re-display the current plan
  @feedback   — Give feedback on completed work
  @diff       — Show cumulative diff
  @pr         — Show PR link
  @tasks      — List all tasks and statuses
  @stop       — Stop this session and go back
  @help       — Show session commands

Any other text is sent directly to the planner.
Use /help for global commands.`;

export function parseReplInput(input: string): {
  command: string;
  args: string[];
} {
  const trimmed = input.trim();
  if (!trimmed) return { command: "", args: [] };

  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return { command, args };
}

/** readline-style completer (kept for tests & potential reuse). */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart();

  if (!trimmed.startsWith("/")) {
    return [[], line];
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    const hits = COMMANDS.filter((c) => c.startsWith(parts[0]));
    return [hits as unknown as string[], parts[0]];
  }

  const cmd = parts[0];
  if (SESSION_ID_COMMANDS.has(cmd) && parts.length === 2) {
    try {
      const sessions = listSessions();
      const partial = parts[1];
      const ids = sessions
        .map((s) => s.id)
        .filter((id) => id.startsWith(partial));
      return [ids, partial];
    } catch {
      return [[], parts[1]];
    }
  }

  return [[], line];
}

/** Return completions for the live autocomplete dropdown. */
export function getCompletions(line: string): string[] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return (COMMANDS as unknown as string[]).filter(
      (c) => c.startsWith(parts[0]) && c !== parts[0],
    );
  }

  const cmd = parts[0];
  if (SESSION_ID_COMMANDS.has(cmd) && parts.length === 2) {
    try {
      const sessions = listSessions();
      const partial = parts[1];
      return sessions
        .map((s) => s.id)
        .filter((id) => id.startsWith(partial) && id !== partial)
        .map((id) => cmd + " " + id);
    } catch {
      return [];
    }
  }

  return [];
}

// ── Live build output watcher ────────────────────────────────────────

/**
 * Attach to a running build's agent log and display output via AgentPanel.
 * Blocks until the build completes or the user presses Enter/Ctrl-C.
 */
function watchBuildLive(sessionId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const panel = new AgentPanel();
    let resolved = false;

    function finish() {
      if (resolved) return;
      resolved = true;
      watcher.stop();
      panel.destroy();
      process.stdin.removeListener("data", onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode!(false);
      }
      process.stdin.pause();
      resolve();
    }

    const watcher = watchLog(sessionId, (event: AgentEvent) => {
      switch (event.type) {
        case "agent-start":
          panel.addAgent(event.id, event.role!, event.taskId!, event.title!);
          break;
        case "output":
          panel.appendOutput(event.id, event.chunk!);
          break;
        case "agent-end":
          panel.completeAgent(event.id, event.success!);
          break;
        case "build-complete":
          finish();
          break;
      }
    });

    // Let user press Enter or Ctrl-C to detach
    function onKey(data: Buffer) {
      const key = data.toString();
      if (key === "\r" || key === "\n" || key === "\x03") {
        console.log("\nDetached from build output.\n");
        finish();
      }
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode!(true);
    }
    process.stdin.resume();
    process.stdin.on("data", onKey);
  });
}

// ── Dispatch (/ commands) ───────────────────────────────────────────

async function dispatch(command: string, args: string[]): Promise<void> {
  switch (command) {
    case "/list": {
      const { handleList } = await import("../commands/list.js");
      await handleList();
      break;
    }
    case "/create": {
      const repo = args.length > 0 ? args[0] : undefined;
      const { handleCreate } = await import("../commands/create.js");
      const result = await handleCreate(repo);
      if (result) {
        activeSession = {
          id: result.id,
          repo: result.repo,
          repoPath: result.repoLocalPath,
          handlers: createSessionHandlers(
            result.id,
            result.repo,
            "",
            result.repoLocalPath,
          ),
        };
        console.log("Type your goal or describe what you want to build.\n");
      }
      break;
    }
    case "/enter": {
      if (args.length < 1) {
        console.log("Usage: /enter <session_id>");
        break;
      }
      const { getSession } = await import("../session/manager.js");
      const session = getSession(args[0]);
      if (!session) {
        console.log(`Session not found: ${args[0]}`);
        break;
      }
      const repoPath = session.repoLocalPath ?? ".";
      activeSession = {
        id: session.id,
        repo: session.repo,
        repoPath,
        handlers: createSessionHandlers(
          session.id,
          session.repo,
          session.goal,
          repoPath,
        ),
      };
      console.log(`\nEntered session ${session.id} (${session.repo})`);
      console.log(`  Goal:   ${session.goal || "(not set yet)"}`);
      console.log(`  Status: ${session.status}\n`);

      // Status-aware guidance on re-entry
      if (session.status === "building" || session.status === "iterating") {
        // Check if there's a live log file with agent output
        const logPath = getLogPath(session.id);
        if (existsSync(logPath)) {
          console.log("Attaching to live build output... (press Enter to detach)\n");
          await watchBuildLive(session.id);
          // Re-check status after watching — build may have completed
          const updated = getSession(session.id);
          if (updated && updated.status === "awaiting_feedback") {
            console.log("Build complete. Send feedback or @feedback <text>.\n");
          } else if (updated && updated.status === "building") {
            console.log(getStatusDisplay(session.id));
            console.log("\nBuild still in progress. Re-enter to reattach, or type @build to restart.\n");
          }
        } else {
          console.log(getStatusDisplay(session.id));
          console.log("Build was interrupted. Type @build to restart.\n");
        }
      } else if (session.status === "awaiting_feedback") {
        console.log(getStatusDisplay(session.id));
        console.log("Send feedback or @feedback <text>.\n");
      } else if (session.status === "planning" && session.planJson) {
        console.log("A plan exists. Type @build or continue chatting.\n");
      } else if (session.status === "planning") {
        console.log("Describe what you want to build.\n");
      }
      break;
    }
    case "/show": {
      if (args.length < 1) {
        console.log("Usage: /show <session_id>");
        break;
      }
      const { handleShow } = await import("../commands/show.js");
      await handleShow(args[0]);
      break;
    }
    case "/stop": {
      if (args.length < 1) {
        console.log("Usage: /stop <session_id>");
        break;
      }
      const { handleStop } = await import("../commands/stop.js");
      await handleStop(args[0]);
      // If we stopped the active session, clear it
      if (activeSession && activeSession.id === args[0]) {
        activeSession = null;
      }
      break;
    }
    case "/delete": {
      if (args.length < 1) {
        console.log("Usage: /delete <session_id>");
        break;
      }
      const { handleDelete } = await import("../commands/delete.js");
      await handleDelete(args[0]);
      if (activeSession && activeSession.id === args[0]) {
        activeSession = null;
      }
      break;
    }
    case "/init": {
      const { runInit, formatInitOutput } = await import("../commands/init.js");
      const result = runInit();
      console.log(formatInitOutput(result));
      break;
    }
    case "/help": {
      if (activeSession) {
        console.log(HELP_TEXT_SESSION);
        console.log();
      }
      console.log(HELP_TEXT_ROOT);
      break;
    }
    default: {
      console.log(
        `Unknown command: ${command}. Type /help for available commands.`,
      );
    }
  }
}

// ── Prompt string ───────────────────────────────────────────────────

function getPrompt(): string {
  if (activeSession) {
    const short =
      activeSession.repo.split("/").pop() || activeSession.id;
    return `${short}> `;
  }
  return "sweteam> ";
}

// ── Main loop ───────────────────────────────────────────────────────

export interface ReplOptions {
  /** Pre-activate a session on startup (used by CLI create/enter). */
  initialSession?: {
    id: string;
    repo: string;
    goal: string;
    repoLocalPath: string;
  };
}

export async function runRepl(opts?: ReplOptions): Promise<void> {
  // Banner
  let recent: RecentSession[] = [];
  try {
    recent = listSessions()
      .slice(0, 3)
      .map((s) => ({ id: s.id, goal: s.goal }));
  } catch {
    // DB may not exist yet on first run
  }

  console.log(renderBanner(recent));
  console.log();

  // Pre-activate session if provided
  if (opts?.initialSession) {
    const s = opts.initialSession;
    activeSession = {
      id: s.id,
      repo: s.repo,
      repoPath: s.repoLocalPath,
      handlers: createSessionHandlers(s.id, s.repo, s.goal, s.repoLocalPath),
    };
    console.log(`Session ${s.id} active. Describe what you want to build.\n`);
  }

  while (true) {
    const line = await promptLine({
      prompt: getPrompt(),
      getCompletions,
    });

    const trimmed = line.trim();
    if (!trimmed) continue;

    // ── / commands always work ──
    if (trimmed.startsWith("/")) {
      const { command, args } = parseReplInput(trimmed);
      if (command === "/exit") break;
      try {
        await dispatch(command, args);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // ── @ commands: only in an active session ──
    if (trimmed.startsWith("@")) {
      if (!activeSession) {
        console.log("No active session. Use /create or /enter first.");
        continue;
      }
      try {
        const stopped = await handleSessionCommand(
          trimmed,
          activeSession.handlers,
        );
        if (stopped) {
          activeSession = null;
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // ── Plain text: send to planner if session is active ──
    if (activeSession) {
      try {
        await activeSession.handlers.onMessage(trimmed);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
    } else {
      console.log(
        "No active session. Use /create or /enter to start one.",
      );
    }
  }

  process.exit(0);
}
