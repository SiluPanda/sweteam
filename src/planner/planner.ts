import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { resolveAdapter } from "../adapters/adapter.js";
import { loadConfig } from "../config/loader.js";
import { getMessages } from "../session/manager.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  "__pycache__",
  ".cache",
  "coverage",
]);

const MANIFEST_FILES = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
];

export function getFilteredFileTree(
  dir: string,
  prefix: string = "",
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
    if (entry.startsWith(".") && entry !== ".env.example") continue;
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
      lines.push(
        ...getFilteredFileTree(fullPath, `${prefix}  `, maxDepth, currentDepth + 1),
      );
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
        return readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function getRecentCommits(repoPath: string, count: number = 20): string {
  try {
    return execSync(`git log --oneline -${count}`, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "(no commits available)";
  }
}

export function buildPlannerPrompt(
  repo: string,
  goal: string,
  repoPath: string,
  chatHistory: Array<{ role: string; content: string }>,
): string {
  const fileTree = getFilteredFileTree(repoPath).join("\n");
  const manifest = getManifestContents(repoPath) ?? "(not found)";
  const commits = getRecentCommits(repoPath);

  const historyText = chatHistory
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n\n");

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
Each task needs: id, title, description, files_likely_touched, depends_on,
acceptance_criteria. Tell the user to type @build when ready.

Do NOT generate code. Only plan.`;
}

export async function invokePlanner(
  sessionId: string,
  repo: string,
  goal: string,
  repoPath: string,
  onOutput?: (chunk: string) => void,
): Promise<string> {
  const config = loadConfig();
  const adapter = resolveAdapter(config.roles.planner, config);

  const chatHistory = getMessages(sessionId).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const prompt = buildPlannerPrompt(repo, goal, repoPath, chatHistory);

  const result = await adapter.execute({
    prompt,
    cwd: repoPath,
    timeout: 0,
    onOutput,
  });

  return result.output;
}
