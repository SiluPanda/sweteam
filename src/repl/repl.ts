import { listSessions, getSession } from '../session/manager.js';
import { transition } from '../session/state-machine.js';
import { renderBanner, type RecentSession } from '../ui/banner.js';
import { promptLine, ESCAPE_SIGNAL } from '../ui/prompt.js';
import {
  createSessionHandlers,
  handleSessionCommand,
  type SessionHandlers,
} from '../session/interactive.js';
import { getStatusDisplay, getHelpDisplay } from '../session/in-session-commands.js';
import { watchLog, isLogActive, writeEvent, type AgentEvent } from '../session/agent-log.js';
import { AgentPanel } from '../ui/agent-panel.js';
import { SessionSidebar } from '../ui/sidebar.js';
import { friendlyError } from '../orchestrator/error-handling.js';
import { hasActiveProcesses } from '../lifecycle.js';
import { c, icons } from '../ui/theme.js';

// ── Active session state ────────────────────────────────────────────

interface ActiveSession {
  id: string;
  repo: string;
  repoPath: string;
  handlers: SessionHandlers;
}

let activeSession: ActiveSession | null = null;
const sidebar = new SessionSidebar();

// ── Commands & completions ──────────────────────────────────────────

const COMMANDS = [
  '/list',
  '/create',
  '/enter',
  '/show',
  '/stop',
  '/delete',
  '/init',
  '/help',
  '/exit',
  '/quit',
] as const;

const SESSION_ID_COMMANDS = new Set(['/enter', '/show', '/stop', '/delete']);

const HELP_TEXT_ROOT = `Commands:
  /create [repo]          Create a new session (defaults to current directory)
  /list                   List all sessions
  /enter <session_id>     Re-enter an existing session
  /show <session_id>      Show detailed session view
  /stop <session_id>      Stop a session
  /delete <session_id>    Delete a session
  /init                   Auto-discover CLIs and generate config
  /help                   Show this help
  /exit, /quit            Quit sweteam`;

export function parseReplInput(input: string): {
  command: string;
  args: string[];
} {
  const trimmed = input.trim();
  if (!trimmed) return { command: '', args: [] };

  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return { command, args };
}

/** readline-style completer (kept for tests & potential reuse). */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart();

  if (!trimmed.startsWith('/')) {
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
      const ids = sessions.map((s) => s.id).filter((id) => id.startsWith(partial));
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
  if (!trimmed.startsWith('/')) return [];

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
        .map((id) => cmd + ' ' + id);
    } catch {
      return [];
    }
  }

  return [];
}

// ── Live build output watcher ────────────────────────────────────────

/**
 * Attach to a running build's agent log and display output via AgentPanel.
 * Blocks until the build completes, the log goes stale, or the user presses
 * Enter/Ctrl-C/Escape.
 */
function watchBuildLive(sessionId: string): Promise<void> {
  sidebar.pause();
  return new Promise<void>((resolve) => {
    const panel = new AgentPanel();
    let resolved = false;
    let lastEventTime = Date.now();

    // Input mode state
    let inputMode = false;
    let inputBuffer = '';
    let pendingRequestId: string | null = null;

    // Declare staleTimer before the watcher so finish() can always access it
    // (avoids TDZ crash if finish() is called during the initial log replay).
    let staleTimer: ReturnType<typeof setInterval> | null = null;

    function onKey(data: Buffer) {
      const key = data.toString();

      if (inputMode) {
        // In input mode: collect typed text
        if (key === '\x1b' || key.startsWith('\x1b')) {
          // Escape (possibly with trailing bytes): cancel input and detach
          process.stdout.write('\n(input cancelled)\n');
          exitInputMode();
          finish('\nDetached from build output.\n');
        } else if (key === '\r' || key === '\n') {
          // Enter: submit the response
          submitInput();
        } else if (key === '\x7f' || key === '\b') {
          // Backspace
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (key === '\x03') {
          // Ctrl-C: cancel input and detach
          process.stdout.write('\n(input cancelled)\n');
          exitInputMode();
          finish('\nDetached from build output.\n');
        } else if (key.charCodeAt(0) >= 32) {
          // Printable character
          inputBuffer += key;
          process.stdout.write(key);
        }
        return;
      }

      // Normal watch mode: Enter/Ctrl-C/Escape to detach
      if (key === '\r' || key === '\n' || key === '\x03' || key.charCodeAt(0) === 0x1b) {
        finish('\nDetached from build output.\n');
      }
    }

    function finish(reason?: string) {
      if (resolved) return;
      resolved = true;
      if (inputMode) {
        exitInputMode();
      }
      if (staleTimer) clearInterval(staleTimer);
      watcher.stop();
      panel.destroy();
      process.stdin.removeListener('data', onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode!(false);
      }
      process.stdin.pause();
      if (reason) console.log(reason);
      sidebar.invalidate();
      sidebar.resume();
      resolve();
    }

    function enterInputMode(promptText: string, requestId: string) {
      inputMode = true;
      inputBuffer = '';
      pendingRequestId = requestId;
      panel.destroy(); // Temporarily clear panel so prompt is visible
      process.stdout.write(`\nInput needed: ${promptText}\n> `);
    }

    function exitInputMode() {
      inputMode = false;
      inputBuffer = '';
      pendingRequestId = null;
    }

    function submitInput() {
      if (!pendingRequestId) return;
      const response = inputBuffer.trim();
      writeEvent(sessionId, {
        type: 'input-response',
        id: pendingRequestId,
        requestId: pendingRequestId,
        response,
      });
      process.stdout.write('\n');
      exitInputMode();
    }

    // Set up stdin BEFORE the watcher so keypresses work immediately,
    // even if the initial replay triggers finish().
    if (process.stdin.isTTY) {
      process.stdin.setRawMode!(true);
    }
    process.stdin.resume();
    process.stdin.on('data', onKey);

    const watcher = watchLog(sessionId, (event: AgentEvent) => {
      if (resolved) return; // Already detached; ignore late events
      lastEventTime = Date.now();
      switch (event.type) {
        case 'agent-start':
          panel.addAgent(event.id, event.role!, event.taskId!, event.title!);
          break;
        case 'output':
          panel.appendOutput(event.id, event.chunk!);
          break;
        case 'agent-end':
          panel.completeAgent(event.id, event.success!);
          break;
        case 'build-complete':
        case 'phase-complete':
          finish();
          break;
        case 'input-needed':
          enterInputMode(event.promptText ?? '(input needed)', event.requestId!);
          break;
        // input-response is handled by the build process, not the REPL watcher
      }
    });

    // Show periodic warnings when no output arrives; auto-detach after 5 minutes
    let warnedAt30s = false;
    let warnedAt2m = false;
    staleTimer = setInterval(() => {
      const idle = Date.now() - lastEventTime;
      if (idle > 300_000) {
        finish(
          '\nNo activity for 5 minutes. Agent may still be running — type @status to check.\n',
        );
      } else if (idle > 120_000 && !warnedAt2m) {
        warnedAt2m = true;
        process.stdout.write(
          '\n⚠ No output for 2 minutes. Press Escape to detach, then @stop to cancel.\n',
        );
      } else if (idle > 30_000 && !warnedAt30s) {
        warnedAt30s = true;
        process.stdout.write('\nStill waiting for output... (agent may be thinking)\n');
      }
    }, 1000);
  });
}

// ── Dispatch (/ commands) ───────────────────────────────────────────

async function dispatch(command: string, args: string[]): Promise<void> {
  switch (command) {
    case '/list': {
      const { handleList } = await import('../commands/list.js');
      await handleList();
      break;
    }
    case '/create': {
      const repo = args.length > 0 ? args[0] : undefined;
      const { handleCreate } = await import('../commands/create.js');
      const result = await handleCreate(repo);
      if (result) {
        activeSession = {
          id: result.id,
          repo: result.repo,
          repoPath: result.repoLocalPath,
          handlers: createSessionHandlers(result.id, result.repo, '', result.repoLocalPath),
        };
        sidebar.setActiveSession(result.id);
        sidebar.invalidate();
        console.log('Type your goal or describe what you want to build.\n');
      }
      break;
    }
    case '/enter': {
      if (args.length < 1) {
        console.log('Usage: /enter <session_id>');
        break;
      }
      const { getSession } = await import('../session/manager.js');
      const session = getSession(args[0]);
      if (!session) {
        console.log(`Session not found: ${args[0]}`);
        break;
      }
      const repoPath = session.repoLocalPath ?? '.';
      activeSession = {
        id: session.id,
        repo: session.repo,
        repoPath,
        handlers: createSessionHandlers(session.id, session.repo, session.goal, repoPath),
      };
      sidebar.setActiveSession(session.id);
      console.log(`\nEntered session ${session.id} (${session.repo})`);
      console.log(`  Goal:   ${session.goal || '(not set yet)'}`);
      console.log(`  Status: ${session.status}\n`);

      // Status-aware guidance on re-entry
      if (session.status === 'building' || session.status === 'iterating') {
        // Check if a build is actually running (log has recent writes OR processes alive)
        if (isLogActive(session.id) || hasActiveProcesses(session.id)) {
          console.log('Attaching to live build output... (press Enter or Escape to detach)\n');
          await watchBuildLive(session.id);
          // Re-check status after watching — build may have completed
          const updated = getSession(session.id);
          if (updated && updated.status === 'awaiting_feedback') {
            console.log('Build complete. Send feedback or @feedback <text>.\n');
          } else if (updated && updated.status === 'building') {
            console.log(getStatusDisplay(session.id));
            console.log(
              '\nBuild still in progress. Re-enter to reattach, or type @build to restart.\n',
            );
          }
        } else {
          // Build is truly stale — no log activity AND no running processes
          try {
            transition(session.id, 'planning');
          } catch {
            /* already transitioned */
          }
          console.log(getStatusDisplay(session.id));
          console.log('Build was interrupted. Type @build to restart.\n');
        }
      } else if (session.status === 'awaiting_feedback') {
        console.log(getStatusDisplay(session.id));
        // Check if build actually completed or was interrupted (all tasks still queued)
        const { getTasksForSession: getTasks } = await import('../orchestrator/orchestrator.js');
        const sessionTasks = getTasks(session.id);
        const allQueued =
          sessionTasks.length > 0 && sessionTasks.every((t) => t.status === 'queued');
        if (allQueued) {
          console.log('Build was interrupted before any tasks ran. Type @build to retry.\n');
        } else {
          console.log('Send feedback or @feedback <text>.\n');
        }
      } else if (session.status === 'stopped') {
        if (session.planJson) {
          console.log('Session stopped. Type @build to rebuild, or chat to refine the plan.\n');
        } else {
          console.log('Session stopped. Send a message to resume planning.\n');
        }
      } else if (session.status === 'planning') {
        if (isLogActive(session.id) || hasActiveProcesses(session.id)) {
          console.log('Planner is running... (press Escape to background)\n');
          await watchBuildLive(session.id);
          const updatedPlanning = getSession(session.id);
          if (updatedPlanning?.planJson) {
            console.log('Plan ready. Type @build to start building, or continue refining.\n');
          }
        } else if (session.planJson) {
          console.log('A plan exists. Type @build or continue chatting.\n');
        } else {
          console.log('Describe what you want to build.\n');
        }
      }
      break;
    }
    case '/show': {
      if (args.length < 1) {
        console.log('Usage: /show <session_id>');
        break;
      }
      const { handleShow } = await import('../commands/show.js');
      await handleShow(args[0]);
      break;
    }
    case '/stop': {
      if (args.length < 1) {
        console.log('Usage: /stop <session_id>');
        break;
      }
      const { handleStop } = await import('../commands/stop.js');
      await handleStop(args[0]);
      // If we stopped the active session, clear it
      if (activeSession && activeSession.id === args[0]) {
        activeSession = null;
        sidebar.setActiveSession(null);
      }
      sidebar.invalidate();
      break;
    }
    case '/delete': {
      if (args.length < 1) {
        console.log('Usage: /delete <session_id>  or  /delete --all');
        break;
      }
      const { handleDelete } = await import('../commands/delete.js');
      await handleDelete(args[0]);
      // Clear active session if it was deleted
      if (activeSession && (args[0] === '--all' || activeSession.id === args[0])) {
        activeSession = null;
        sidebar.setActiveSession(null);
      }
      sidebar.invalidate();
      break;
    }
    case '/init': {
      const { runInit, formatInitOutput } = await import('../commands/init.js');
      const result = runInit();
      console.log(formatInitOutput(result));
      break;
    }
    case '/help': {
      if (activeSession) {
        console.log(getHelpDisplay(activeSession.id));
        console.log();
      }
      console.log(HELP_TEXT_ROOT);
      break;
    }
    default: {
      console.log(`Unknown command: ${command}. Type /help for available commands.`);
    }
  }
}

// ── Prompt string ───────────────────────────────────────────────────

const PROMPT_STATE_COLORS: Record<string, (s: string) => string> = {
  planning: c.info,
  building: c.warning,
  awaiting_feedback: c.success,
  iterating: c.pink,
  stopped: c.error,
};

const PROMPT_STATE_LABELS: Record<string, string> = {
  planning: 'planning',
  building: 'building',
  awaiting_feedback: 'feedback',
  iterating: 'iterating',
  stopped: 'stopped',
};

function getPrompt(): string {
  if (activeSession) {
    const short = activeSession.repo.split('/').pop() || activeSession.id;
    let stateTag = '';
    try {
      const session = getSession(activeSession.id);
      if (session?.status) {
        const label = PROMPT_STATE_LABELS[session.status] ?? session.status;
        const colorFn = PROMPT_STATE_COLORS[session.status] ?? c.subtle;
        stateTag = c.muted('(') + colorFn(label) + c.muted(')');
      }
    } catch {
      // DB may be unavailable
    }
    return `${c.cyan(short)}${stateTag ? ' ' + stateTag : ''} ${c.primary(icons.arrow)} `;
  }
  return `${c.primaryBold('sweteam')} ${c.primary(icons.arrow)} `;
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
  /** Image file paths to attach to the initial session. */
  images?: string[];
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

  // Start the persistent session sidebar
  sidebar.start();

  // Recalculate layout on terminal resize
  process.stdout.on('resize', () => {
    sidebar.invalidate();
  });

  // Pre-activate session if provided
  if (opts?.initialSession) {
    const s = opts.initialSession;
    const handlers = createSessionHandlers(s.id, s.repo, s.goal, s.repoLocalPath);
    activeSession = {
      id: s.id,
      repo: s.repo,
      repoPath: s.repoLocalPath,
      handlers,
    };
    sidebar.setActiveSession(s.id);
    if (opts.images && opts.images.length > 0) {
      handlers.onImage(opts.images);
    }
    console.log(`Session ${s.id} active. Describe what you want to build.\n`);
  }

  while (true) {
    const line = await promptLine({
      prompt: getPrompt(),
      getCompletions,
      reservedRight: sidebar.width,
    });

    // ── Escape: leave session, go back to sweteam> ──
    if (line === ESCAPE_SIGNAL) {
      if (activeSession) {
        const short = activeSession.repo.split('/').pop() || activeSession.id;
        console.log(`Left session ${activeSession.id} (${short})`);
        activeSession = null;
        sidebar.setActiveSession(null);
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // ── / commands always work ──
    if (trimmed.startsWith('/')) {
      const { command, args } = parseReplInput(trimmed);
      if (command === '/exit' || command === '/quit') break;
      try {
        await dispatch(command, args);
      } catch (err) {
        console.error(friendlyError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }

    // ── @ commands: only in an active session ──
    if (trimmed.startsWith('@')) {
      if (!activeSession) {
        console.log('No active session. Use /create or /enter first.');
        continue;
      }

      // @cancel — cancel in-flight planner
      if (trimmed === '@cancel') {
        try {
          await handleSessionCommand(trimmed, activeSession.handlers);
        } catch (err) {
          console.error(friendlyError(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      // @watch — re-attach to live agent output
      if (trimmed === '@watch') {
        if (isLogActive(activeSession.id) || hasActiveProcesses(activeSession.id)) {
          console.log('Attaching to live output... (press Enter or Escape to detach)\n');
          await watchBuildLive(activeSession.id);
          const { getSession: gs } = await import('../session/manager.js');
          const updated = gs(activeSession.id);
          if (updated?.status === 'awaiting_feedback') {
            console.log('Build complete. Send feedback or @feedback <text>.\n');
          }
        } else {
          console.log('No active agent output. Use @status to check progress.');
        }
        continue;
      }

      try {
        const stopped = await handleSessionCommand(trimmed, activeSession.handlers);
        if (stopped) {
          activeSession = null;
          sidebar.setActiveSession(null);
          sidebar.invalidate();
        }
        // After @build or @feedback, auto-attach to live output
        if ((trimmed === '@build' || trimmed.startsWith('@feedback ')) && activeSession) {
          if (isLogActive(activeSession.id) || hasActiveProcesses(activeSession.id)) {
            console.log('Watching output... (press Escape to background)\n');
            await watchBuildLive(activeSession.id);
            // Re-check session status after watching
            const { getSession: gs } = await import('../session/manager.js');
            const updated = gs(activeSession.id);
            if (updated?.status === 'awaiting_feedback') {
              console.log('Build complete. Send feedback or @feedback <text>.\n');
            } else if (updated?.status === 'building' || updated?.status === 'iterating') {
              console.log(getStatusDisplay(activeSession.id));
              console.log('\nBuild running in background. Type @status to check progress.\n');
            }
          }
        }
      } catch (err) {
        console.error(friendlyError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }

    // ── Plain text: send to planner if session is active ──
    if (activeSession) {
      try {
        await activeSession.handlers.onMessage(trimmed);
        // Auto-attach to live output (planner or feedback running in background)
        if (activeSession && (isLogActive(activeSession.id) || hasActiveProcesses(activeSession.id))) {
          await watchBuildLive(activeSession.id);
          // Show status-appropriate message after watcher detaches
          if (activeSession) {
            const updated = getSession(activeSession.id);
            if (updated?.status === 'awaiting_feedback') {
              console.log('Build complete. Send feedback or @feedback <text>.\n');
            } else if (updated?.status === 'planning' && updated?.planJson) {
              // Display the planner's response so the user can see the plan
              console.log('\n' + updated.planJson + '\n');
            }
          }
        }
      } catch (err) {
        console.error(friendlyError(err instanceof Error ? err.message : String(err)));
      }
    } else {
      console.log('No active session. Use /create or /enter to start one.');
    }
  }

  sidebar.stop();
  process.exit(0);
}
