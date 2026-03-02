import * as readline from "readline";
import { addMessage, getMessages } from "./manager.js";

export type ChatCommand =
  | { type: "build" }
  | { type: "stop" }
  | { type: "help" }
  | { type: "plan" }
  | { type: "status" }
  | { type: "diff" }
  | { type: "pr" }
  | { type: "tasks" }
  | { type: "feedback"; text: string }
  | { type: "message"; text: string };

export function parseInput(input: string): ChatCommand {
  const trimmed = input.trim();

  if (trimmed === "@build") return { type: "build" };
  if (trimmed === "@stop") return { type: "stop" };
  if (trimmed === "@help") return { type: "help" };
  if (trimmed === "@plan") return { type: "plan" };
  if (trimmed === "@status") return { type: "status" };
  if (trimmed === "@diff") return { type: "diff" };
  if (trimmed === "@pr") return { type: "pr" };
  if (trimmed === "@tasks") return { type: "tasks" };

  if (trimmed.startsWith("@feedback ")) {
    return { type: "feedback", text: trimmed.slice("@feedback ".length) };
  }

  return { type: "message", text: trimmed };
}

export function getHelpText(): string {
  return [
    "Available commands:",
    "  @build      — Finalize plan and start autonomous coding",
    "  @status     — Show current task progress",
    "  @plan       — Re-display the current plan",
    "  @feedback   — Give feedback on completed work",
    "  @diff       — Show cumulative diff",
    "  @pr         — Show PR link",
    "  @tasks      — List all tasks and statuses",
    "  @stop       — Stop this session",
    "  @help       — Show this help message",
  ].join("\n");
}

export interface ChatLoopCallbacks {
  onBuild: () => Promise<void>;
  onStop: () => Promise<void>;
  onMessage: (text: string) => Promise<string>;
  onFeedback?: (text: string) => Promise<void>;
  onPlan?: () => Promise<string | null>;
  onStatus?: () => Promise<string>;
  onDiff?: () => Promise<string>;
  onPr?: () => Promise<string>;
  onTasks?: () => Promise<string>;
}

export async function runChatLoop(
  sessionId: string,
  callbacks: ChatLoopCallbacks,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("> ", async (input) => {
      if (!input || input.trim().length === 0) {
        prompt();
        return;
      }

      const command = parseInput(input);

      switch (command.type) {
        case "build":
          await callbacks.onBuild();
          break;

        case "stop":
          await callbacks.onStop();
          rl.close();
          return;

        case "help":
          console.log(getHelpText());
          break;

        case "plan":
          if (callbacks.onPlan) {
            const plan = await callbacks.onPlan();
            console.log(plan ?? "No plan finalized yet.");
          }
          break;

        case "status":
          if (callbacks.onStatus) {
            console.log(await callbacks.onStatus());
          }
          break;

        case "diff":
          if (callbacks.onDiff) {
            console.log(await callbacks.onDiff());
          }
          break;

        case "pr":
          if (callbacks.onPr) {
            console.log(await callbacks.onPr());
          }
          break;

        case "tasks":
          if (callbacks.onTasks) {
            console.log(await callbacks.onTasks());
          }
          break;

        case "feedback":
          addMessage(sessionId, "user", command.text, { type: "feedback" });
          if (callbacks.onFeedback) {
            await callbacks.onFeedback(command.text);
          }
          break;

        case "message":
          addMessage(sessionId, "user", command.text, { phase: "planning" });
          const response = await callbacks.onMessage(command.text);
          addMessage(sessionId, "agent", response, { phase: "planning" });
          break;
      }

      prompt();
    });
  };

  prompt();
}
