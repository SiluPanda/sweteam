import { deleteSession, getSession } from "../session/manager.js";

export async function handleDelete(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  deleteSession(sessionId);
  console.log(`Session ${sessionId} deleted.`);
}
