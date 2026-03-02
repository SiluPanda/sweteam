export interface ParsedTask {
  id: string;
  title: string;
  description: string;
  filesLikelyTouched: string[];
  dependsOn: string[];
  acceptanceCriteria: string[];
}

export interface ParsedPlan {
  tasks: ParsedTask[];
  raw: string;
}

function tryParseJson(text: string): ParsedTask[] | null {
  // Try to extract JSON from the response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());

    // Handle array of tasks directly
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeTask);
    }

    // Handle { tasks: [...] } wrapper
    if (parsed.tasks && Array.isArray(parsed.tasks)) {
      return parsed.tasks.map(normalizeTask);
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeTask(raw: Record<string, unknown>, index: number): ParsedTask {
  return {
    id: String(raw.id ?? `task-${String(index + 1).padStart(3, "0")}`),
    title: String(raw.title ?? "Untitled task"),
    description: String(raw.description ?? ""),
    filesLikelyTouched: toStringArray(raw.files_likely_touched ?? raw.filesLikelyTouched ?? raw.files ?? []),
    dependsOn: toStringArray(raw.depends_on ?? raw.dependsOn ?? raw.dependencies ?? []),
    acceptanceCriteria: toStringArray(raw.acceptance_criteria ?? raw.acceptanceCriteria ?? raw.criteria ?? []),
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseMarkdown(text: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  // Match markdown task sections like: ### task-001: Title or ### Task 1: Title
  const taskPattern = /###\s*(?:task[-_]?)?(\d+|[a-z]+-\d+)[:\s]+(.+?)(?:\n|$)/gi;
  let match;

  while ((match = taskPattern.exec(text)) !== null) {
    const rawId = match[1];
    const title = match[2].trim();
    const id = rawId.includes("-") ? rawId : `task-${String(rawId).padStart(3, "0")}`;

    // Get content until next ### or end
    const startIdx = match.index + match[0].length;
    const nextMatch = text.indexOf("\n###", startIdx);
    const content = text.slice(startIdx, nextMatch === -1 ? undefined : nextMatch);

    const description = extractSection(content, "description") || content.trim().split("\n")[0] || "";
    const files = extractListItems(content, "files");
    const deps = extractListItems(content, "depends|dependencies|deps");
    const criteria = extractListItems(content, "acceptance|criteria");

    tasks.push({
      id,
      title,
      description,
      filesLikelyTouched: files,
      dependsOn: deps,
      acceptanceCriteria: criteria,
    });
  }

  return tasks;
}

function extractSection(content: string, keyword: string): string {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*\\*?\\*?${keyword}\\*?\\*?[:\\s]*(.+?)(?=\\n\\s*\\*?\\*?\\w+[:\\s]|$)`,
    "is",
  );
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function extractListItems(content: string, keyword: string): string[] {
  const pattern = new RegExp(
    `(?:${keyword})[:\\s]*\\n((?:\\s*[-*]\\s+.+\\n?)+)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

export function parsePlan(agentOutput: string): ParsedPlan {
  // Try JSON first
  const jsonTasks = tryParseJson(agentOutput);
  if (jsonTasks && jsonTasks.length > 0) {
    return { tasks: jsonTasks, raw: agentOutput };
  }

  // Fall back to markdown parsing
  const mdTasks = parseMarkdown(agentOutput);
  if (mdTasks.length > 0) {
    return { tasks: mdTasks, raw: agentOutput };
  }

  return { tasks: [], raw: agentOutput };
}
