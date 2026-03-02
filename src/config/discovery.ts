import { execSync } from "child_process";

export interface CliInfo {
  name: string;
  available: boolean;
  path?: string;
  version?: string;
}

const CLI_TOOLS = [
  { name: "claude", versionFlag: "--version" },
  { name: "codex", versionFlag: "--version" },
  { name: "opencode", versionFlag: "--version" },
  { name: "gh", versionFlag: "--version" },
  { name: "git", versionFlag: "--version" },
] as const;

function tryExec(command: string): string | null {
  try {
    return execSync(command, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function detectCli(name: string, versionFlag: string): CliInfo {
  const whichResult = tryExec(`which ${name}`);
  if (!whichResult) {
    return { name, available: false };
  }

  const versionResult = tryExec(`${name} ${versionFlag}`);
  const version = versionResult
    ? versionResult.split("\n")[0].trim()
    : undefined;

  return {
    name,
    available: true,
    path: whichResult,
    version,
  };
}

export function discoverClis(): CliInfo[] {
  return CLI_TOOLS.map((tool) => detectCli(tool.name, tool.versionFlag));
}

export function getDiscoveredAgents(
  clis: CliInfo[],
): Record<string, { command: string; args: string[] }> {
  const agents: Record<string, { command: string; args: string[] }> = {};

  for (const cli of clis) {
    if (!cli.available) continue;

    switch (cli.name) {
      case "claude":
        agents["claude-code"] = { command: "claude", args: ["-p"] };
        break;
      case "codex":
        agents["codex"] = { command: "codex", args: ["-q"] };
        break;
      case "opencode":
        agents["opencode"] = {
          command: "opencode",
          args: ["--non-interactive"],
        };
        break;
    }
  }

  return agents;
}
