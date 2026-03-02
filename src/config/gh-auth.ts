import { execSync } from "child_process";

export function validateGhAuth(): { authenticated: boolean; message: string } {
  try {
    const output = execSync("gh auth status", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    return { authenticated: true, message: output.trim() };
  } catch (err) {
    return {
      authenticated: false,
      message: "GitHub CLI is not authenticated. Run `gh auth login` first.",
    };
  }
}
