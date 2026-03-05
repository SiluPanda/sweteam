import React from "react";
import { Box, Text } from "ink";

export interface DashboardTask {
  id: string;
  title: string;
  status: string;
}

interface TaskRowProps {
  task: DashboardTask;
}

function statusIcon(status: string): string {
  switch (status) {
    case "done":
      return "✓";
    case "running":
      return "▶";
    case "reviewing":
      return "⟳";
    case "fixing":
      return "🔧";
    case "failed":
      return "✗";
    case "blocked":
      return "⊘";
    case "queued":
      return "◌";
    default:
      return "○";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "green";
    case "running":
      return "blue";
    case "reviewing":
      return "cyan";
    case "fixing":
      return "yellow";
    case "failed":
      return "red";
    case "blocked":
      return "gray";
    default:
      return "white";
  }
}

export function TaskRow({ task }: TaskRowProps): React.ReactElement {
  const icon = statusIcon(task.status);
  const color = statusColor(task.status);

  return React.createElement(
    Box,
    { gap: 1 },
    React.createElement(Text, { color }, icon),
    React.createElement(Text, { dimColor: true }, task.id),
    React.createElement(Text, null, task.title),
    React.createElement(Text, { color }, `[${task.status}]`),
  );
}

interface DashboardProps {
  tasks: DashboardTask[];
  sessionId: string;
}

export function Dashboard({ tasks, sessionId }: DashboardProps): React.ReactElement {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const running = tasks.filter((t) => t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const queued = tasks.filter((t) => t.status === "queued").length;

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const filled = Math.min(20, Math.max(0, Math.floor(pct / 5)));
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1, borderStyle: "round" },
    React.createElement(
      Text,
      { bold: true },
      `Task Dashboard — ${sessionId}`,
    ),
    React.createElement(Box, { marginTop: 1 }),
    ...tasks.map((task) =>
      React.createElement(TaskRow, { key: task.id, task }),
    ),
    React.createElement(Box, { marginTop: 1 }),
    React.createElement(
      Text,
      null,
      `[${bar}] ${pct}%`,
    ),
    React.createElement(
      Text,
      { dimColor: true },
      `Done: ${done} | Running: ${running + tasks.filter((t) => t.status === "reviewing" || t.status === "fixing").length} | Queued: ${queued} | Failed: ${failed}${tasks.filter((t) => t.status === "blocked").length > 0 ? ` | Blocked: ${tasks.filter((t) => t.status === "blocked").length}` : ""}`,
    ),
  );
}
