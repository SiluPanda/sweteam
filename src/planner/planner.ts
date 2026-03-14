import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveAdapter } from '../adapters/adapter.js';
import { loadConfig } from '../config/loader.js';
import { getMessages } from '../session/manager.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'target',
  'vendor',
  '__pycache__',
  '.cache',
  'coverage',
]);

const MANIFEST_FILES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
];

export function getFilteredFileTree(
  dir: string,
  prefix: string = '',
  maxDepth: number = 4,
  currentDepth: number = 0,
): string[] {
  if (currentDepth >= maxDepth) return [];

  const lines: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries.sort()) {
    if (entry.startsWith('.') && entry !== '.env.example') continue;
    if (IGNORED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      lines.push(`${prefix}${entry}/`);
      lines.push(...getFilteredFileTree(fullPath, `${prefix}  `, maxDepth, currentDepth + 1));
    } else {
      lines.push(`${prefix}${entry}`);
    }
  }

  return lines;
}

export function getManifestContents(repoPath: string): string | null {
  for (const manifest of MANIFEST_FILES) {
    const filePath = join(repoPath, manifest);
    if (existsSync(filePath)) {
      try {
        return readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function getRecentCommits(repoPath: string, count: number = 20): string {
  try {
    return execFileSync('git', ['log', '--oneline', `-${count}`], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return '(no commits available)';
  }
}

export function buildPlannerPrompt(
  repo: string,
  goal: string,
  repoPath: string,
  chatHistory: Array<{ role: string; content: string }>,
): string {
  const fileTree = getFilteredFileTree(repoPath).join('\n');
  const manifest = getManifestContents(repoPath) ?? '(not found)';
  const commits = getRecentCommits(repoPath);

  const historyText = chatHistory.map((m) => `[${m.role}] ${m.content}`).join('\n\n');

  return `You are a senior software architect helping plan a coding task.
Be concise and direct. You're in a conversation with the user.

## Repository
- Name: ${repo}
- File tree:
${fileTree}

- Package manifest:
${manifest}

- Recent commits:
${commits}

## User's Goal
${goal}

## Conversation So Far
${historyText}

When the user seems happy with the direction, propose a task breakdown.
Output the tasks as a JSON code block with this exact schema:

\`\`\`json
[
  {
    "id": "1",
    "title": "Short task title",
    "description": "What to do",
    "files_likely_touched": ["path/to/file.py"],
    "depends_on": [],
    "acceptance_criteria": ["criterion 1"]
  }
]
\`\`\`

Tell the user to type @build when ready.
Do NOT generate code. Only plan.`;
}

export function buildArchitectPrompt(
  repo: string,
  goal: string,
  repoPath: string,
  sessionStatus: string,
  tasksSummary: string,
  chatHistory: Array<{ role: string; content: string }>,
  question: string,
): string {
  const fileTree = getFilteredFileTree(repoPath).join('\n');
  const manifest = getManifestContents(repoPath) ?? '(not found)';
  const commits = getRecentCommits(repoPath);

  const historyText = chatHistory.map((m) => `[${m.role}] ${m.content}`).join('\n\n');

  return `You are a senior software architect. The user is asking you a question about an ongoing development session. Answer concisely and helpfully based on the context below.

## Repository
- Name: ${repo}
- File tree:
${fileTree}

- Package manifest:
${manifest}

- Recent commits:
${commits}

## Session Context
- Goal: ${goal}
- Current status: ${sessionStatus}

## Task Progress
${tasksSummary || '(no tasks created yet)'}

## Conversation History
${historyText || '(no messages yet)'}

## User's Question
${question}

Answer the question directly. Reference specific tasks, files, or context as needed. Do NOT propose new plans or generate code — just answer what was asked.`;
}

export async function invokeArchitect(
  sessionId: string,
  repo: string,
  goal: string,
  repoPath: string,
  sessionStatus: string,
  tasksSummary: string,
  question: string,
  onOutput?: (chunk: string) => void,
  images?: string[],
): Promise<string> {
  const config = loadConfig();
  const adapter = resolveAdapter(config.roles.planner, config);

  const chatHistory = getMessages(sessionId, 50).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const prompt = buildArchitectPrompt(
    repo,
    goal,
    repoPath,
    sessionStatus,
    tasksSummary,
    chatHistory,
    question,
  );

  const result = await adapter.execute({
    prompt,
    cwd: repoPath,
    timeout: 0,
    images,
    onOutput,
  });

  return result.output;
}

export async function invokePlanner(
  sessionId: string,
  repo: string,
  goal: string,
  repoPath: string,
  onOutput?: (chunk: string) => void,
  images?: string[],
): Promise<string> {
  const config = loadConfig();
  const adapter = resolveAdapter(config.roles.planner, config);

  const chatHistory = getMessages(sessionId, 50).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const prompt = buildPlannerPrompt(repo, goal, repoPath, chatHistory);

  const result = await adapter.execute({
    prompt,
    cwd: repoPath,
    timeout: 20 * 60 * 1000, // 20-min safety net for truly hung processes
    images,
    onOutput,
  });

  return result.output;
}
