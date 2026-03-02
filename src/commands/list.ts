import chalk from "chalk";
import {
  listSessionsEnriched,
  type EnrichedSession,
} from "../session/manager.js";
import { relativeTime } from "../utils/time.js";
import { vLen, rPad } from "../ui/banner.js";

export function formatStatus(session: EnrichedSession): string {
  const { status, planReady, messageCount, tasksDone, tasksTotal, prNumber } =
    session;

  switch (status) {
    case "planning":
      if (messageCount <= 1) return "planning (new)";
      if (planReady) return "planning (plan ready)";
      return `planning (${messageCount} msgs)`;

    case "building":
      if (tasksTotal > 0) return `building (${tasksDone}/${tasksTotal})`;
      return "building";

    case "awaiting_feedback":
      return prNumber ? `feedback (PR #${prNumber})` : "awaiting feedback";

    case "iterating":
      if (tasksTotal > 0) return `iterating (${tasksDone}/${tasksTotal})`;
      return "iterating";

    case "stopped":
      return "stopped";

    default:
      return status;
  }
}

/** Truncate `s` to `max` visible chars and pad to exactly `max`. */
function fit(s: string, max: number): string {
  if (s.length > max) return s.slice(0, max - 1) + "…";
  return s.padEnd(max);
}

/** Right-align `s` within `width` chars. */
function rAlign(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return " ".repeat(width - s.length) + s;
}

// Column widths
const COL = { id: 14, repo: 22, goal: 26, status: 22, updated: 10 } as const;

export function formatSessionTable(sessionList: EnrichedSession[]): string {
  if (sessionList.length === 0) {
    return "No sessions found. Use `sweteam create <repo> <goal>` to start one.";
  }

  const border = chalk.blue;
  const dim = chalk.dim;
  const head = chalk.bold.blueBright;

  // Inner width = sum of columns + gaps (1 space between each pair + 2 padding each side)
  const innerW =
    COL.id + COL.repo + COL.goal + COL.status + COL.updated + 4 + 4;

  const top = border("╭" + "─".repeat(innerW) + "╮");
  const bot = border("╰" + "─".repeat(innerW) + "╯");
  const mid = border("├" + "─".repeat(innerW) + "┤");

  const row = (content: string) =>
    border("│") + "  " + rPad(content, innerW - 2) + border("│");

  // Title
  const titleLine = row(head("sweteam Sessions"));

  // Header
  const headerLine = row(
    [
      head(fit("ID", COL.id)),
      head(fit("Repo", COL.repo)),
      head(fit("Goal", COL.goal)),
      head(fit("Status", COL.status)),
      head(rAlign("Updated", COL.updated)),
    ].join(" "),
  );

  // Separator
  const sepLine = row(
    dim(
      [
        "─".repeat(COL.id),
        "─".repeat(COL.repo),
        "─".repeat(COL.goal),
        "─".repeat(COL.status),
        "─".repeat(COL.updated),
      ].join(" "),
    ),
  );

  // Data rows
  const dataRows = sessionList.map((s) => {
    return row(
      [
        chalk.cyan(fit(s.id, COL.id)),
        fit(s.repo, COL.repo),
        dim(fit(s.goal, COL.goal)),
        fit(formatStatus(s), COL.status),
        rAlign(relativeTime(s.updatedAt), COL.updated),
      ].join(" "),
    );
  });

  return [top, titleLine, mid, headerLine, sepLine, ...dataRows, bot].join(
    "\n",
  );
}

export async function handleList(
  filters?: { status?: string; repo?: string },
): Promise<void> {
  let sessionList = listSessionsEnriched();

  if (filters?.status) {
    sessionList = sessionList.filter((s) => s.status === filters.status);
  }
  if (filters?.repo) {
    const repoFilter = filters.repo.toLowerCase();
    sessionList = sessionList.filter((s) =>
      s.repo.toLowerCase().includes(repoFilter),
    );
  }

  console.log(formatSessionTable(sessionList));
}
