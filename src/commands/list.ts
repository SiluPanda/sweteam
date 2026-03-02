import { listSessions } from "../session/manager.js";

export function formatSessionTable(
  sessionList: Array<{
    id: string;
    repo: string;
    goal: string;
    status: string;
    prUrl: string | null;
    prNumber: number | null;
  }>,
): string {
  if (sessionList.length === 0) {
    return "No sessions found. Use `sweteam create <repo> <goal>` to start one.";
  }

  const header = `${"ID".padEnd(14)} ${"Repo".padEnd(22)} ${"Goal".padEnd(26)} ${"Status".padEnd(20)}`;
  const separator = `${"─".repeat(14)} ${"─".repeat(22)} ${"─".repeat(26)} ${"─".repeat(20)}`;

  const rows = sessionList.map((s) => {
    const id = s.id.padEnd(14);
    const repo = s.repo.length > 20 ? s.repo.slice(0, 19) + "…" : s.repo.padEnd(22);
    const goalTrunc = s.goal.length > 24 ? s.goal.slice(0, 23) + "…" : s.goal.padEnd(26);
    const prInfo = s.prNumber ? ` (PR #${s.prNumber})` : "";
    const status = (s.status + prInfo).padEnd(20);
    return `${id} ${repo} ${goalTrunc} ${status}`;
  });

  return [
    "╔══════════════════════════════════════════════════════════════════════════════════════╗",
    "║  sweteam Sessions                                                                  ║",
    "╠══════════════════════════════════════════════════════════════════════════════════════╣",
    `║  ${header}  ║`,
    `║  ${separator}  ║`,
    ...rows.map((r) => `║  ${r}  ║`),
    "╚══════════════════════════════════════════════════════════════════════════════════════╝",
  ].join("\n");
}

export async function handleList(): Promise<void> {
  const sessionList = listSessions();
  console.log(formatSessionTable(sessionList));
}
