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

/** Strip inline markdown formatting (bold, italic, code spans) from a string. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")   // **bold**
    .replace(/__(.+?)__/g, "$1")         // __bold__
    .replace(/\*(.+?)\*/g, "$1")         // *italic*
    .replace(/(?<=^|\s)_([^_]+)_(?=\s|$)/g, "$1")  // _italic_ (only with surrounding whitespace, preserves underscores in identifiers)
    .replace(/`([^`]+)`/g, "$1")         // `code`
    .trim();
}

function normalizeTask(raw: Record<string, unknown>, index: number): ParsedTask {
  const rawId = String(raw.id ?? `task-${String(index + 1).padStart(3, "0")}`);
  return {
    id: stripInlineMarkdown(rawId),
    title: stripInlineMarkdown(String(raw.title ?? "Untitled task")),
    description: stripInlineMarkdown(String(raw.description ?? "")),
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
  // Match markdown task sections like: ### task-001: Title or ### Task 1: Title or ### 1. Title
  const taskPattern = /###\s*(?:task[-_\s]?)?(\d+|[a-z]+-\d+)[.:\s]+(.+?)(?:\n|$)/gi;
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
    const deps = extractListItems(content, "depends_on|depends|dependencies|deps");
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

function parseTable(text: string): ParsedTask[] {
  // Match markdown tables with a header row containing "id" and "title"
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("|") && /\bid\b/i.test(lines[i]) && /\btitle\b/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return [];

  // Split table row into cells, preserving empty cells but stripping
  // the leading/trailing empty strings from outer `|` delimiters
  const parseCells = (line: string): string[] => {
    const cells = line.split("|").map((c) => c.trim());
    // Remove leading/trailing empty strings from outer pipes
    if (cells.length > 0 && cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const headers = parseCells(lines[headerIdx]).map((h) =>
    h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, ""),
  );

  // Skip separator row (e.g., |---|---|)
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && /^[\s|:-]+$/.test(lines[dataStart])) {
    dataStart++;
  }

  const tasks: ParsedTask[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    if (!lines[i].includes("|")) continue;
    const cells = parseCells(lines[i]);
    if (cells.length < 2) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      row[headers[j]] = cells[j];
    }

    tasks.push({
      id: stripInlineMarkdown(row.id || `task-${String(tasks.length + 1).padStart(3, "0")}`),
      title: row.title || "Untitled task",
      description: row.description || "",
      filesLikelyTouched: (row.files_likely_touched || row.files || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
      dependsOn: (row.depends_on || row.dependencies || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
      acceptanceCriteria: (row.acceptance_criteria || row.criteria || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
    });
  }

  return tasks;
}

/** Normalize box-drawing characters (│┌┬┐├┼┤└┴┘─) to ASCII equivalents for parsing. */
function normalizeBoxDrawing(text: string): string {
  return text
    .replace(/│/g, "|")
    .replace(/[┌┬┐├┼┤└┴┘─]/g, "-")
    .replace(/[…]/g, "...");
}

export function parsePlan(agentOutput: string): ParsedPlan {
  // Try JSON first
  const jsonTasks = tryParseJson(agentOutput);
  if (jsonTasks && jsonTasks.length > 0) {
    return { tasks: jsonTasks, raw: agentOutput };
  }

  // Try markdown headers
  const mdTasks = parseMarkdown(agentOutput);
  if (mdTasks.length > 0) {
    return { tasks: mdTasks, raw: agentOutput };
  }

  // Try markdown table
  const tableTasks = parseTable(agentOutput);
  if (tableTasks.length > 0) {
    return { tasks: tableTasks, raw: agentOutput };
  }

  // Retry with box-drawing characters normalized to ASCII
  const normalized = normalizeBoxDrawing(agentOutput);
  const normalizedTable = parseTable(normalized);
  if (normalizedTable.length > 0) {
    return { tasks: normalizedTable, raw: agentOutput };
  }

  return { tasks: [], raw: agentOutput };
}
