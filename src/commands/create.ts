import { createSession } from "../session/manager.js";

export async function handleCreate(
  repoInput: string,
  goal: string,
): Promise<void> {
  try {
    console.log(`Creating session for "${repoInput}" with goal: ${goal}`);

    const session = await createSession(repoInput, goal);

    console.log(`\nSession created:`);
    console.log(`  ID:     ${session.id}`);
    console.log(`  Repo:   ${session.repo}`);
    console.log(`  Branch: ${session.workingBranch}`);
    console.log(`  Status: planning`);
    console.log(`\nEntering planning chat...`);

    // Planning chat will be wired in Task 36
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create session: ${message}`);
    process.exit(1);
  }
}
