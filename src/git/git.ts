import { execSync } from "child_process";

export function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export function gh(args: string, cwd: string): string {
  return execSync(`gh ${args}`, {
    cwd,
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

export function resolveRepo(input: string): string {
  // Full GitHub URL: https://github.com/owner/repo
  if (input.startsWith("https://")) {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      return match[1].replace(/\.git$/, "");
    }
    return input;
  }

  // Already fully qualified: owner/repo
  if (input.includes("/")) {
    return input;
  }

  // Short name: just repo name — resolve via gh api
  const user = gh("api user -q .login", ".");
  return `${user}/${input}`;
}
