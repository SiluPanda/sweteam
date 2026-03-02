import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { discoverClis, getDiscoveredAgents } from "../config/discovery.js";
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  stringifyTOML,
  type SweteamConfig,
} from "../config/loader.js";

export interface InitResult {
  configPath: string;
  configWritten: boolean;
  clis: Array<{ name: string; available: boolean; version?: string }>;
}

export function runInit(
  configPath: string = CONFIG_PATH,
  opts: { force?: boolean } = {},
): InitResult {
  const clis = discoverClis();
  const agents = getDiscoveredAgents(clis);

  const firstAgent = Object.keys(agents)[0] || "claude-code";

  const config: SweteamConfig = {
    ...DEFAULT_CONFIG,
    roles: {
      planner: firstAgent,
      coder: firstAgent,
      reviewer: firstAgent,
    },
    agents,
  };

  let configWritten = false;
  if (!existsSync(configPath) || opts.force) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, stringifyTOML(config as any), "utf-8");
    configWritten = true;
  }

  return {
    configPath,
    configWritten,
    clis: clis.map((c) => ({
      name: c.name,
      available: c.available,
      version: c.version,
    })),
  };
}

export function formatInitOutput(result: InitResult): string {
  const lines: string[] = [];

  for (const cli of result.clis) {
    const icon = cli.available ? "\u2713" : "\u2717";
    const version = cli.version ? ` (${cli.version})` : "";
    const status = cli.available
      ? `Found ${cli.name}${version}`
      : `${cli.name} not found`;
    lines.push(`${icon} ${status}`);
  }

  if (result.configWritten) {
    lines.push(`Generated ${result.configPath}`);
  } else {
    lines.push(`Config already exists at ${result.configPath}`);
  }

  return lines.join("\n");
}
