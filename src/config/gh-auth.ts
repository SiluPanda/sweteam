import { execFileSync } from "child_process";

export function validateGhAuth(): { authenticated: boolean; message: string } {
  try {
    // gh auth status writes output to stderr, not stdout
    execFileSync("gh", ["auth", "status"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    return { authenticated: true, message: "GitHub CLI is authenticated." };
  } catch (err) {
    return {
      authenticated: false,
      message: "GitHub CLI is not authenticated. Run `gh auth login` first.",
    };
  }
}
