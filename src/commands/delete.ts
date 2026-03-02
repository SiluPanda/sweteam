import { deleteSession, getSession } from "../session/manager.js";

export async function handleDelete(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  deleteSession(sessionId);
  console.log(`Session ${sessionId} deleted.`);
}
