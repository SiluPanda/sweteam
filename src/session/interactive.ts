import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { stopSession, addMessage, getSession } from './manager.js';
import { invokePlanner, invokeArchitect } from '../planner/planner.js';
import { handleBuild } from '../orchestrator/build-handler.js';
import { handleFeedback } from '../orchestrator/feedback-handler.js';
import { transition } from './state-machine.js';
import { clearLog, writeEvent } from './agent-log.js';
import { friendlyError } from '../orchestrator/error-handling.js';
import {
  getStatusDisplay,
  getPlanDisplay,
  getDiffDisplay,
  getPrDisplay,
  getTasksDisplay,
  getHelpDisplay,
} from './in-session-commands.js';
import { killSessionProcesses } from '../lifecycle.js';

// ── Planner activity tracking ─────────────────────────────────────
interface PlannerState {
  inProgress: boolean;
  startedAt: number | null;
  lastActivityAt: number | null;
}

const plannerStates = new Map<string, PlannerState>();

/** Get current planner state for a session (used by @status). */
export function getPlannerState(sessionId: string): PlannerState | undefined {
  return plannerStates.get(sessionId);
}

/**
 * Handlers for an active session.
 * Each method is self-contained (stores messages, streams output, etc.).
 */
export interface SessionHandlers {
  /** Send a plain-text message to the planner and stream the response. */
  onMessage: (text: string) => Promise<void>;
  /** Finalize the plan and kick off the autonomous build. */
  onBuild: () => Promise<void>;
  /** Stop the session. */
  onStop: () => Promise<void>;
  /** Process user feedback on completed work. */
  onFeedback: (text: string) => Promise<void>;
  /** Show the current plan. */
  onPlan: () => Promise<void>;
  /** Show task progress. */
  onStatus: () => Promise<void>;
  /** Show cumulative diff. */
  onDiff: () => Promise<void>;
  /** Show PR link. */
  onPr: () => Promise<void>;
  /** List tasks. */
  onTasks: () => Promise<void>;
  /** Ask the architect agent a question about the development process. */
  onAsk: (question: string) => Promise<void>;
  /** Cancel the in-flight planner without stopping the session. */
  onCancel: () => Promise<void>;
  /** Show available session commands. */
  onHelp: () => void;
}

/**
 * Create handlers for a session.  Used by both the REPL (active-session
 * mode) and the standalone CLI flow.
 */
export function createSessionHandlers(
  sessionId: string,
  repo: string,
  goal: string,
  repoPath: string,
): SessionHandlers {
  // Hydrate lastPlannerResponse from DB so @build works after re-entry
  const existingSession = getSession(sessionId);
  let lastPlannerResponse = '';
  if (existingSession?.planJson) {
    try {
      const parsed = JSON.parse(existingSession.planJson);
      lastPlannerResponse = parsed.raw ?? existingSession.planJson;
    } catch {
      lastPlannerResponse = existingSession.planJson;
    }
  }
  let currentGoal = goal;
  let buildInProgress = false;
  let planningInProgress = false;
  plannerStates.set(sessionId, { inProgress: false, startedAt: null, lastActivityAt: null });

  const handlers: SessionHandlers = {
    onMessage: async (text: string): Promise<void> => {
      // Capture the first user message as the session goal if not set
      if (!currentGoal) {
        currentGoal = text.length > 120 ? text.slice(0, 117) + '...' : text;
        const db = getDb();
        db.update(sessions)
          .set({ goal: currentGoal, updatedAt: new Date() })
          .where(eq(sessions.id, sessionId))
          .run();
      }

      // Route based on session status
      const session = getSession(sessionId);
      if (session?.status === 'building' || session?.status === 'iterating') {
        // Build or iteration is in progress — queue message as feedback for when it completes
        console.log(
          'A build is currently in progress. Your message will be treated as feedback when it completes.',
        );
        console.log('Use @stop to cancel the current build first, or wait for it to finish.\n');
        addMessage(sessionId, 'user', text, { phase: 'feedback-pending' });
        return;
      }
      if (session?.status === 'awaiting_feedback') {
        // Already awaiting feedback — route directly to feedback handler in background
        handleFeedback(sessionId, text).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          addMessage(sessionId, 'system', `Feedback failed: ${msg}`);
        });
        await new Promise((r) => setTimeout(r, 300));
        return;
      }

      if (planningInProgress) {
        console.log(
          'Planner is already running. Press Escape to background, then re-enter later.\n',
        );
        return;
      }

      // Resume stopped session into planning
      if (session?.status === 'stopped') {
        transition(sessionId, 'planning');
      }

      // Default: planning — invoke planner in background
      addMessage(sessionId, 'user', text, { phase: 'planning' });

      const plannerId = 'planner';
      clearLog(sessionId);
      writeEvent(sessionId, {
        type: 'agent-start',
        id: plannerId,
        role: 'Planner',
        taskId: sessionId,
        title: currentGoal,
      });

      planningInProgress = true;
      plannerStates.set(sessionId, {
        inProgress: true,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      invokePlanner(sessionId, repo, currentGoal, repoPath, (chunk) => {
        writeEvent(sessionId, { type: 'output', id: plannerId, chunk });
        const ps = plannerStates.get(sessionId);
        if (ps) ps.lastActivityAt = Date.now();
      })
        .then((response) => {
          writeEvent(sessionId, { type: 'agent-end', id: plannerId, success: true });

          lastPlannerResponse = response;
          addMessage(sessionId, 'agent', response, { phase: 'planning' });

          // Persist draft plan so it survives session re-entry
          const db = getDb();
          db.update(sessions)
            .set({ planJson: response, updatedAt: new Date() })
            .where(eq(sessions.id, sessionId))
            .run();

          writeEvent(sessionId, { type: 'phase-complete', id: plannerId });
        })
        .catch((err) => {
          writeEvent(sessionId, { type: 'agent-end', id: plannerId, success: false });

          const msg = err instanceof Error ? err.message : String(err);
          const errResponse = `Error invoking planner: ${friendlyError(msg)}`;
          addMessage(sessionId, 'agent', errResponse, { phase: 'planning' });

          writeEvent(sessionId, { type: 'phase-complete', id: plannerId });
        })
        .finally(() => {
          planningInProgress = false;
          plannerStates.set(sessionId, {
            inProgress: false,
            startedAt: null,
            lastActivityAt: null,
          });
        });

      // Give the planner a moment to start writing events
      await new Promise((r) => setTimeout(r, 300));
    },

    onBuild: async (): Promise<void> => {
      // Guard against concurrent builds
      if (buildInProgress) {
        console.log('A build is already in progress. Use @stop to cancel it first.');
        return;
      }

      // Check session state — but allow restart if the build is stale (interrupted)
      const currentSession = getSession(sessionId);
      if (currentSession?.status === 'building' || currentSession?.status === 'iterating') {
        const { isLogActive } = await import('../session/agent-log.js');
        if (isLogActive(sessionId)) {
          console.log('A build is already in progress. Use @stop to cancel it first.');
          return;
        }
        // Build is stale/interrupted — recover to planning so we can restart
        try {
          transition(sessionId, 'planning');
        } catch {
          /* already transitioned */
        }
      }

      if (!lastPlannerResponse) {
        // Try loading plan from DB as a fallback (e.g. after session re-entry)
        const s = getSession(sessionId);
        if (s?.planJson) {
          lastPlannerResponse = s.planJson;
        } else {
          console.log('No plan generated yet. Chat with the planner first, then type @build.');
          return;
        }
      }

      console.log('\nPlan finalized. Starting autonomous build...\n');

      // Run build in the background so the REPL stays responsive.
      // The user sees output via the agent log watcher and can
      // detach (Escape/Enter) and reattach (/enter) freely.
      const planSnapshot = lastPlannerResponse;
      buildInProgress = true;
      handleBuild(sessionId, planSnapshot)
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\nBuild failed: ${friendlyError(msg)}\n`);
          addMessage(sessionId, 'system', `Build failed: ${msg}`);
          // Recover to planning state so user can retry
          try {
            transition(sessionId, 'planning');
          } catch {
            /* already transitioned */
          }
        })
        .finally(() => {
          buildInProgress = false;
        });

      // Give the build a moment to start writing events, then attach
      await new Promise((r) => setTimeout(r, 300));
    },

    onStop: async (): Promise<void> => {
      buildInProgress = false;
      stopSession(sessionId);
      console.log(`\nSession ${sessionId} stopped.\n`);
    },

    onFeedback: async (text: string): Promise<void> => {
      // During planning, feedback refines the plan — route through the planner
      const session = getSession(sessionId);
      if (session?.status === 'planning') {
        console.log('\nRefining plan with your feedback...\n');
        return handlers.onMessage(text);
      }

      console.log('\nProcessing feedback...\n');
      handleFeedback(sessionId, text).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Feedback processing failed: ${msg}`);
        addMessage(sessionId, 'system', `Feedback failed: ${msg}`);
      });
      // Give the feedback handler time to start writing events
      await new Promise((r) => setTimeout(r, 300));
    },

    onPlan: async (): Promise<void> => {
      const plan = await getPlanDisplay(sessionId);
      console.log(plan ?? 'No plan finalized yet.');
    },

    onStatus: async (): Promise<void> => {
      console.log(await getStatusDisplay(sessionId));
    },

    onDiff: async (): Promise<void> => {
      console.log(await getDiffDisplay(sessionId));
    },

    onPr: async (): Promise<void> => {
      console.log(await getPrDisplay(sessionId));
    },

    onTasks: async (): Promise<void> => {
      console.log(await getTasksDisplay(sessionId));
    },

    onAsk: async (question: string): Promise<void> => {
      const session = getSession(sessionId);
      const status = session?.status ?? 'unknown';

      // Build task summary from DB
      const { getTasksForSession } = await import('../orchestrator/orchestrator.js');
      const sessionTasks = getTasksForSession(sessionId);
      const tasksSummary =
        sessionTasks.length > 0
          ? sessionTasks.map((t) => `  ${t.id}: ${t.title} [${t.status}]`).join('\n')
          : '';

      addMessage(sessionId, 'user', `@ask ${question}`, { phase: 'ask' });

      const askId = 'architect';
      clearLog(sessionId);
      writeEvent(sessionId, {
        type: 'agent-start',
        id: askId,
        role: 'Architect',
        taskId: sessionId,
        title: question,
      });

      invokeArchitect(
        sessionId,
        repo,
        currentGoal,
        repoPath,
        status,
        tasksSummary,
        question,
        (chunk) => {
          writeEvent(sessionId, { type: 'output', id: askId, chunk });
        },
      )
        .then((response) => {
          writeEvent(sessionId, { type: 'agent-end', id: askId, success: true });
          addMessage(sessionId, 'agent', response, { phase: 'ask' });
          writeEvent(sessionId, { type: 'phase-complete', id: askId });
        })
        .catch((err) => {
          writeEvent(sessionId, { type: 'agent-end', id: askId, success: false });
          const msg = err instanceof Error ? err.message : String(err);
          const errResponse = `Error invoking architect: ${friendlyError(msg)}`;
          addMessage(sessionId, 'agent', errResponse, { phase: 'ask' });
          writeEvent(sessionId, { type: 'phase-complete', id: askId });
        });

      // Give the architect a moment to start writing events
      await new Promise((r) => setTimeout(r, 300));
    },

    onCancel: async (): Promise<void> => {
      if (!planningInProgress) {
        console.log('No planner running to cancel.');
        return;
      }
      killSessionProcesses(sessionId);
      planningInProgress = false;
      plannerStates.set(sessionId, { inProgress: false, startedAt: null, lastActivityAt: null });
      writeEvent(sessionId, { type: 'phase-complete', id: 'planner' });
      console.log('\nPlanning cancelled. Send a new message to restart planning.\n');
    },

    onHelp: (): void => {
      console.log(getHelpDisplay(sessionId));
    },
  };

  return handlers;
}

/**
 * Handle an @-command inside an active session.
 * Returns true if the command was a @stop (session ended).
 */
export async function handleSessionCommand(
  input: string,
  handlers: SessionHandlers,
): Promise<boolean> {
  const trimmed = input.trim();

  if (trimmed === '@build') {
    await handlers.onBuild();
  } else if (trimmed === '@stop') {
    await handlers.onStop();
    return true; // session ended
  } else if (trimmed === '@help') {
    handlers.onHelp();
  } else if (trimmed === '@plan') {
    await handlers.onPlan();
  } else if (trimmed === '@status') {
    await handlers.onStatus();
  } else if (trimmed === '@diff') {
    await handlers.onDiff();
  } else if (trimmed === '@pr') {
    await handlers.onPr();
  } else if (trimmed === '@tasks') {
    await handlers.onTasks();
  } else if (trimmed === '@cancel') {
    await handlers.onCancel();
  } else if (trimmed === '@ask') {
    console.log('Usage: @ask <your question>');
  } else if (trimmed.startsWith('@ask ')) {
    await handlers.onAsk(trimmed.slice('@ask '.length));
  } else if (trimmed === '@feedback') {
    console.log('Usage: @feedback <your feedback text>');
  } else if (trimmed.startsWith('@feedback ')) {
    await handlers.onFeedback(trimmed.slice('@feedback '.length));
  } else {
    console.log(`Unknown command: ${trimmed}. Type @help for session commands.`);
  }

  return false;
}
