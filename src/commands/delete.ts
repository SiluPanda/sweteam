import { deleteSession, getSession, listSessions } from '../session/manager.js';

export async function handleDelete(sessionId: string): Promise<void> {
  if (sessionId === '--all' || sessionId === '-all') {
    const all = listSessions();
    if (all.length === 0) {
      console.log('No sessions to delete.');
      return;
    }
    const errors: string[] = [];
    for (const s of all) {
      try {
        await deleteSession(s.id);
      } catch (err) {
        errors.push(`${s.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const deleted = all.length - errors.length;
    console.log(`Deleted ${deleted} of ${all.length} sessions.`);
    if (errors.length > 0) {
      console.error(`Failed to delete:\n${errors.map((e) => `  ${e}`).join('\n')}`);
    }
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  await deleteSession(sessionId);
  console.log(`Session ${sessionId} deleted.`);
}
