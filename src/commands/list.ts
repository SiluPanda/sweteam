import {
  listSessionsEnriched,
  type EnrichedSession,
} from "../session/manager.js";
import { relativeTime } from "../utils/time.js";

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

export function formatSessionTable(sessionList: EnrichedSession[]): string {
  if (sessionList.length === 0) {
    return "No sessions found. Use `sweteam create <repo> <goal>` to start one.";
  }

  const header = `${"ID".padEnd(14)} ${"Repo".padEnd(22)} ${"Goal".padEnd(24)} ${"Status".padEnd(24)} ${"Updated".padEnd(8)}`;
  const separator = `${"─".repeat(14)} ${"─".repeat(22)} ${"─".repeat(24)} ${"─".repeat(24)} ${"─".repeat(8)}`;

  const rows = sessionList.map((s) => {
    const id = s.id.padEnd(14);
    const repo =
      s.repo.length > 20 ? s.repo.slice(0, 19) + "…" : s.repo.padEnd(22);
    const goalTrunc =
      s.goal.length > 22 ? s.goal.slice(0, 21) + "…" : s.goal.padEnd(24);
    const status = formatStatus(s).padEnd(24);
    const updated = relativeTime(s.updatedAt).padEnd(8);
    return `${id} ${repo} ${goalTrunc} ${status} ${updated}`;
  });

  const boxWidth = 98;
  return [
    "╔" + "═".repeat(boxWidth) + "╗",
    "║  sweteam Sessions" + " ".repeat(boxWidth - 20) + "  ║",
    "╠" + "═".repeat(boxWidth) + "╣",
    `║  ${header}  ║`,
    `║  ${separator}  ║`,
    ...rows.map((r) => `║  ${r}  ║`),
    "╚" + "═".repeat(boxWidth) + "╝",
  ].join("\n");
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
