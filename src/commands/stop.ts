import { stopSession, getSession } from "../session/manager.js";

export async function handleStop(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  stopSession(sessionId);
  console.log(`Session ${sessionId} stopped.`);
}
