import { getSession } from "./manager.js";
import { transition, type SessionStatus } from "./state-machine.js";

export function canResume(sessionId: string): {
  resumable: boolean;
  allowedActions: string[];
  message: string;
} {
  const session = getSession(sessionId);
  if (!session) {
    return { resumable: false, allowedActions: [], message: "Session not found" };
  }

  if (session.status === "stopped") {
    return {
      resumable: true,
      allowedActions: ["@build", "@feedback"],
      message: `Session is stopped. Use @build to resume building or @feedback to give feedback.`,
    };
  }

  if (session.status === "building") {
    return {
      resumable: true,
      allowedActions: ["@build", "chat"],
      message: `Build was interrupted. Type @build to restart, or send feedback.`,
    };
  }

  if (session.status === "awaiting_feedback") {
    return {
      resumable: true,
      allowedActions: ["@feedback"],
      message: `Session is awaiting feedback. Use @feedback to provide feedback.`,
    };
  }

  if (session.status === "planning") {
    return {
      resumable: true,
      allowedActions: ["@build", "chat"],
      message: `Session is in planning. Continue chatting or type @build when ready.`,
    };
  }

  return {
    resumable: false,
    allowedActions: [],
    message: `Session is currently ${session.status}. Please wait.`,
  };
}

export function resumeSession(
  sessionId: string,
  action: "build" | "iterate",
): void {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (session.status !== "stopped") {
    throw new Error(
      `Cannot resume: session is ${session.status}, not stopped`,
    );
  }

  const targetStatus: SessionStatus =
    action === "build" ? "building" : "iterating";
  transition(sessionId, targetStatus);
}
