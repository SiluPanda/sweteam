import { createInterface } from 'readline';
import { deleteSession, getSession, listSessions } from '../session/manager.js';

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function handleDelete(sessionId: string, flags?: string[]): Promise<void> {
  if (sessionId === '--all' || sessionId === '-all') {
    const all = listSessions();
    if (all.length === 0) {
      console.log('No sessions to delete.');
      return;
    }

    const force = flags?.includes('--force') ?? false;

    if (!force) {
      if (!process.stdin.isTTY) {
        console.error(
          `Refusing to delete ${all.length} session(s) without confirmation. Use --force in non-interactive mode.`,
        );
        return;
      }
      const accepted = await confirm(
        `This will delete ${all.length} session(s). Are you sure? (y/n) `,
      );
      if (!accepted) {
        console.log('Aborted.');
        return;
      }
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
