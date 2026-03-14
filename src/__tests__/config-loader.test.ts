import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, DEFAULT_CONFIG } from '../config/loader.js';

describe('config/loader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('should return default config when file does not exist', () => {
    const config = loadConfig('/nonexistent/path/config.toml');
    expect(config.roles.planner).toBe('claude-code');
    expect(config.roles.coder).toBe('claude-code');
    expect(config.roles.reviewer).toBe('claude-code');
    expect(config.execution.max_parallel).toBe(3);
    expect(config.execution.max_review_cycles).toBe(3);
    expect(config.execution.branch_prefix).toBe('sw/');
    expect(config.git.commit_style).toBe('conventional');
    expect(config.git.squash_on_merge).toBe(true);
  });

  it('should parse a valid TOML config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-test-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'config.toml');

    writeFileSync(
      configPath,
      `
[roles]
planner = "codex"
coder = "codex"
reviewer = "claude-code"

[execution]
max_parallel = 5
max_review_cycles = 2
branch_prefix = "feat/"

[git]
commit_style = "simple"
squash_on_merge = false

[agents.codex]
command = "codex"
args = ["-q"]
`,
    );

    const config = loadConfig(configPath);
    expect(config.roles.planner).toBe('codex');
    expect(config.roles.coder).toBe('codex');
    expect(config.roles.reviewer).toBe('claude-code');
    expect(config.execution.max_parallel).toBe(5);
    expect(config.execution.max_review_cycles).toBe(2);
    expect(config.execution.branch_prefix).toBe('feat/');
    expect(config.git.commit_style).toBe('simple');
    expect(config.git.squash_on_merge).toBe(false);
    expect(config.agents.codex.command).toBe('codex');
  });

  it('should merge partial config with defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-test-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'config.toml');

    writeFileSync(
      configPath,
      `
[roles]
reviewer = "codex"

[agents.codex]
command = "codex"
args = ["-q"]
`,
    );

    const config = loadConfig(configPath);
    // Override
    expect(config.roles.reviewer).toBe('codex');
    // Defaults preserved
    expect(config.roles.planner).toBe('claude-code');
    expect(config.roles.coder).toBe('claude-code');
    expect(config.execution.max_parallel).toBe(3);
  });

  it('should have correct default agents config', () => {
    expect(DEFAULT_CONFIG.agents['claude-code']).toEqual({
      command: 'claude',
      args: ['-p'],
    });
  });
});
