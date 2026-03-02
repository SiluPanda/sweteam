import type { SweteamConfig } from "../config/loader.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { OpenCodeAdapter } from "./opencode.js";
import { CustomAdapter } from "./custom.js";

export interface AgentResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface AgentAdapter {
  name: string;

  isAvailable(): Promise<boolean>;

  execute(opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
  }): Promise<AgentResult>;
}

const BUILTIN_ADAPTERS: Record<string, () => AgentAdapter> = {
  "claude-code": () => new ClaudeCodeAdapter(),
  codex: () => new CodexAdapter(),
  opencode: () => new OpenCodeAdapter(),
};

export function resolveAdapter(
  name: string,
  config: SweteamConfig,
): AgentAdapter {
  if (BUILTIN_ADAPTERS[name]) {
    return BUILTIN_ADAPTERS[name]();
  }

  const agentConfig = config.agents[name];
  if (!agentConfig) {
    throw new Error(`Unknown agent: ${name}. Check your config.`);
  }

  return new CustomAdapter(name, agentConfig);
}
