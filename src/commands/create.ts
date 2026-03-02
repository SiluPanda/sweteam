import { createSession } from "../session/manager.js";
import { isGitRepo, getRepoRoot } from "../git/git.js";

export interface CreateResult {
  id: string;
  repo: string;
  repoLocalPath: string;
  workingBranch: string;
}

export async function handleCreate(repoInput?: string): Promise<CreateResult | null> {
  try {
    let local = false;
    let effectiveRepo: string;

    if (repoInput) {
      effectiveRepo = repoInput;
    } else {
      const cwd = process.cwd();
      if (!isGitRepo(cwd)) {
        console.error(
          "Current directory is not a git repository.\n" +
            "Run `git init` first, or pass a repo: /create <repo>",
        );
        return null;
      }
      effectiveRepo = getRepoRoot(cwd);
      local = true;
    }

    console.log(`Creating session for "${effectiveRepo}"…`);

    const session = await createSession({
      repoInput: effectiveRepo,
      local,
    });

    console.log(`\nSession created:`);
    console.log(`  ID:     ${session.id}`);
    console.log(`  Repo:   ${session.repo}`);
    console.log(`  Branch: ${session.workingBranch}`);
    console.log(`  Status: planning\n`);

    return session;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create session: ${message}`);
    return null;
  }
}
