import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { getHelpText } from "./chat.js";
import { stopSession, addMessage, getSession } from "./manager.js";
import { invokePlanner } from "../planner/planner.js";
import { handleBuild } from "../orchestrator/build-handler.js";
import { handleFeedback } from "../orchestrator/feedback-handler.js";
import { transition } from "./state-machine.js";
import { AgentPanel } from "../ui/agent-panel.js";
import {
  getStatusDisplay,
  getPlanDisplay,
  getDiffDisplay,
  getPrDisplay,
  getTasksDisplay,
} from "./in-session-commands.js";

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
  let lastPlannerResponse = "";
  let currentGoal = goal;

  return {
    onMessage: async (text: string): Promise<void> => {
      // Capture the first user message as the session goal if not set
      if (!currentGoal) {
        currentGoal = text.length > 120 ? text.slice(0, 117) + "..." : text;
        const db = getDb();
        db.update(sessions)
          .set({ goal: currentGoal, updatedAt: new Date() })
          .where(eq(sessions.id, sessionId))
          .run();
      }

      // If session is stuck in building (e.g. after a failed/timed-out build),
      // transition back to planning so the user can iterate with the planner.
      const session = getSession(sessionId);
      if (session?.status === "building") {
        transition(sessionId, "planning");
      }

      addMessage(sessionId, "user", text, { phase: "planning" });

      const panel = new AgentPanel();
      panel.addAgent("planner", "Planner", sessionId, currentGoal);

      try {
        const response = await invokePlanner(
          sessionId,
          repo,
          currentGoal,
          repoPath,
          (chunk) => {
            panel.appendOutput("planner", chunk);
          },
        );
        panel.completeAgent("planner", true);
        panel.destroy();

        if (!response.trim()) {
          console.log("\n(planner returned empty response)\n");
        }

        lastPlannerResponse = response;
        addMessage(sessionId, "agent", response, { phase: "planning" });
      } catch (err) {
        panel.completeAgent("planner", false);
        panel.destroy();

        const msg = err instanceof Error ? err.message : String(err);
        const errResponse = `Error invoking planner: ${msg}`;
        console.error("\n" + errResponse + "\n");
        addMessage(sessionId, "agent", errResponse, { phase: "planning" });
      }
    },

    onBuild: async (): Promise<void> => {
      if (!lastPlannerResponse) {
        console.log(
          "No plan generated yet. Chat with the planner first, then type @build.",
        );
        return;
      }

      console.log("\nPlan finalized. Starting autonomous build...\n");
      try {
        await handleBuild(sessionId, lastPlannerResponse);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Build failed: ${msg}`);
        addMessage(sessionId, "system", `Build failed: ${msg}`);
      }
    },

    onStop: async (): Promise<void> => {
      stopSession(sessionId);
      console.log(`\nSession ${sessionId} stopped.\n`);
    },

    onFeedback: async (text: string): Promise<void> => {
      console.log("\nProcessing feedback...\n");
      try {
        await handleFeedback(sessionId, text);
        console.log("Feedback iteration complete. PR updated.\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Feedback processing failed: ${msg}`);
        addMessage(sessionId, "system", `Feedback failed: ${msg}`);
      }
    },

    onPlan: async (): Promise<void> => {
      const plan = await getPlanDisplay(sessionId);
      console.log(plan ?? "No plan finalized yet.");
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

    onHelp: (): void => {
      console.log(getHelpText());
    },
  };
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

  if (trimmed === "@build") {
    await handlers.onBuild();
  } else if (trimmed === "@stop") {
    await handlers.onStop();
    return true; // session ended
  } else if (trimmed === "@help") {
    handlers.onHelp();
  } else if (trimmed === "@plan") {
    await handlers.onPlan();
  } else if (trimmed === "@status") {
    await handlers.onStatus();
  } else if (trimmed === "@diff") {
    await handlers.onDiff();
  } else if (trimmed === "@pr") {
    await handlers.onPr();
  } else if (trimmed === "@tasks") {
    await handlers.onTasks();
  } else if (trimmed.startsWith("@feedback ")) {
    await handlers.onFeedback(trimmed.slice("@feedback ".length));
  } else {
    console.log(`Unknown command: ${trimmed}. Type @help for session commands.`);
  }

  return false;
}
