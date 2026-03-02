import { stopSession, getSession } from "../session/manager.js";

export async function handleStop(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  stopSession(sessionId);
  console.log(`Session ${sessionId} stopped.`);
}
