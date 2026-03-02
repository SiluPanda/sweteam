import React from "react";
import { Box, Text } from "ink";

export interface SessionEntry {
  id: string;
  repo: string;
  goal: string;
  status: string;
  prNumber: number | null;
}

interface SessionRowProps {
  session: SessionEntry;
}

export function SessionRow({ session }: SessionRowProps): React.ReactElement {
  const goalTrunc =
    session.goal.length > 30
      ? session.goal.slice(0, 27) + "..."
      : session.goal;
  const prInfo = session.prNumber ? ` (PR #${session.prNumber})` : "";

  return React.createElement(
    Box,
    { gap: 1 },
    React.createElement(Text, { color: "cyan" }, session.id.padEnd(14)),
    React.createElement(Text, null, session.repo.padEnd(22)),
    React.createElement(Text, { dimColor: true }, goalTrunc.padEnd(32)),
    React.createElement(Text, { color: "green" }, session.status + prInfo),
  );
}

interface SessionListViewProps {
  sessions: SessionEntry[];
}

export function SessionListView({
  sessions,
}: SessionListViewProps): React.ReactElement {
  if (sessions.length === 0) {
    return React.createElement(
      Box,
      { padding: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        "No sessions found. Use `sweteam create <repo> <goal>` to start one.",
      ),
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1, borderStyle: "round" },
    React.createElement(Text, { bold: true }, "sweteam Sessions"),
    React.createElement(Box, { marginTop: 1 }),
    React.createElement(
      Box,
      { gap: 1 },
      React.createElement(Text, { bold: true }, "ID".padEnd(14)),
      React.createElement(Text, { bold: true }, "Repo".padEnd(22)),
      React.createElement(Text, { bold: true }, "Goal".padEnd(32)),
      React.createElement(Text, { bold: true }, "Status"),
    ),
    ...sessions.map((s, i) =>
      React.createElement(SessionRow, { key: i, session: s }),
    ),
  );
}
