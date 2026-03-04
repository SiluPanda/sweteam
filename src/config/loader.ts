import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseTOML, stringify as stringifyTOML } from "@iarna/toml";

const CONFIG_PATH = join(homedir(), ".sweteam", "config.toml");

export interface AgentConfig {
  command: string;
  args?: string[];
  prompt_via?: "stdin" | "arg" | "file";
  output_from?: "stdout" | "file";
}

export interface SweteamConfig {
  roles: {
    planner: string;
    coder: string;
    reviewer: string;
  };
  execution: {
    max_parallel: number;
    max_review_cycles: number;
    branch_prefix: string;
  };
  git: {
    commit_style: "conventional" | "simple";
    squash_on_merge: boolean;
  };
  agents: Record<string, AgentConfig>;
}

const DEFAULT_CONFIG: SweteamConfig = {
  roles: {
    planner: "claude-code",
    coder: "claude-code",
    reviewer: "claude-code",
  },
  execution: {
    max_parallel: 3,
    max_review_cycles: 3,
    branch_prefix: "sw/",
  },
  git: {
    commit_style: "conventional",
    squash_on_merge: true,
  },
  agents: {
    "claude-code": {
      command: "claude",
      args: ["-p"],
    },
  },
};

/** CLI overrides passed from command-line flags. */
export interface ConfigOverrides {
  coder?: string;
  reviewer?: string;
  parallel?: number;
}

let _overrides: ConfigOverrides = {};

/** Set global CLI overrides (called once at startup from index.ts). */
export function setConfigOverrides(overrides: ConfigOverrides): void {
  _overrides = overrides;
}

export function loadConfig(configPath: string = CONFIG_PATH): SweteamConfig {
  let config: SweteamConfig;

  if (!existsSync(configPath)) {
    config = {
      roles: { ...DEFAULT_CONFIG.roles },
      execution: { ...DEFAULT_CONFIG.execution },
      git: { ...DEFAULT_CONFIG.git },
      agents: { ...DEFAULT_CONFIG.agents },
    };
  } else {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseTOML(raw) as unknown as Partial<SweteamConfig>;

    config = {
      roles: { ...DEFAULT_CONFIG.roles, ...parsed.roles },
      execution: { ...DEFAULT_CONFIG.execution, ...parsed.execution },
      git: { ...DEFAULT_CONFIG.git, ...parsed.git },
      agents: { ...DEFAULT_CONFIG.agents, ...parsed.agents },
    };
  }

  // Apply CLI overrides
  if (_overrides.coder) config.roles.coder = _overrides.coder;
  if (_overrides.reviewer) config.roles.reviewer = _overrides.reviewer;
  if (_overrides.parallel && _overrides.parallel > 0) {
    config.execution.max_parallel = _overrides.parallel;
  }

  return config;
}

export { CONFIG_PATH, DEFAULT_CONFIG, stringifyTOML };
