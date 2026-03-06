import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions } from "../db/schema.js";

export type SessionStatus =
  | "planning"
  | "building"
  | "awaiting_feedback"
  | "iterating"
  | "stopped";

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  planning: ["building", "stopped"],
  building: ["awaiting_feedback", "planning", "stopped"],
  awaiting_feedback: ["building", "iterating", "stopped"],
  iterating: ["awaiting_feedback", "planning", "stopped"],
  stopped: ["planning", "building", "iterating"],
};

export function validateTransition(
  from: SessionStatus,
  to: SessionStatus,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function transition(sessionId: string, newStatus: SessionStatus): void {
  const db = getDb();

  const rows = db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all();

  if (rows.length === 0) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const currentStatus = rows[0].status as SessionStatus;

  if (!validateTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid transition: ${currentStatus} → ${newStatus}`,
    );
  }

  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (newStatus === "stopped") {
    updates.stoppedAt = updates.updatedAt;
  } else if (currentStatus === "stopped") {
    // Clear stoppedAt when leaving the stopped state
    updates.stoppedAt = null;
  }

  db.update(sessions).set(updates).where(eq(sessions.id, sessionId)).run();

  const stateLabels: Record<string, string> = {
    planning: "Planning",
    building: "Building",
    awaiting_feedback: "Awaiting feedback",
    iterating: "Iterating",
    stopped: "Stopped",
  };
  const label = stateLabels[newStatus] ?? newStatus;
  console.log(`[${label}]`);
}
