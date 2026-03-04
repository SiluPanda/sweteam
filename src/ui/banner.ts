import chalk from "chalk";
import os from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const VERSION = pkg.version;

// ── Blue theme palette ──────────────────────────────────────────────
const border = chalk.blue;
const accent = chalk.blueBright;
const title = chalk.bold.blueBright;
const dim = chalk.dim;
const cmd = chalk.cyanBright;

// ── Helpers ─────────────────────────────────────────────────────────

/** Visible length of a string after stripping ANSI escape codes. */
export function vLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad string to `w` visible characters (right-pad with spaces). */
export function rPad(s: string, w: number): string {
  const diff = w - vLen(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

/** Shorten cwd by replacing homedir with ~. */
function shortCwd(): string {
  const cwd = process.cwd();
  const home = os.homedir();
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

// ── Public API ──────────────────────────────────────────────────────

export interface RecentSession {
  id: string;
  goal: string;
}

export function renderBanner(sessions: RecentSession[] = []): string {
  const termW = process.stdout.columns || 80;
  // Box outer width = termW - 1 (leave 1 col margin to avoid terminal wrap)
  // Inner = outer - 2 (left + right border)
  // Inner splits into left | divider | right → LW + 1 + RW = IW
  const IW = Math.max(termW - 3, 60); // -3: left border + right border + margin
  const LW = Math.min(44, Math.floor(IW * 0.4));
  const RW = IW - 1 - LW; // remaining goes to right

  // ── Mascot (from README, blue-styled) ──
  const mascot = [
    accent("  ┌─────────────────┐"),
    accent("  │") + "    ◉       ◉    " + accent("│"),
    accent("  │") + "    ─────────    " + accent("│"),
    accent("  └─────────────────┘"),
  ];

  // ── Left column ──
  const left: string[] = [
    "",
    title("        Welcome to sweteam!"),
    "",
    ...mascot.map((l) => "        " + l),
    "",
    dim(`      Orchestrator · v${VERSION}`),
    dim("      " + shortCwd()),
    "",
  ];

  // ── Right column ──
  const maxCmdPad = Math.max(RW - 30, 4);
  const right: string[] = [
    "",
    title(" Getting started"),
    " " + cmd("/create") + dim(" [repo]") + " ".repeat(Math.max(maxCmdPad - 6, 1)) + "Start a new session",
    " " + cmd("/list") + " ".repeat(Math.max(maxCmdPad + 5, 1)) + "See all sessions",
    " " + cmd("/enter") + dim(" <id>") + " ".repeat(Math.max(maxCmdPad - 3, 1)) + "Resume a session",
    " " + dim("─".repeat(Math.max(RW - 4, 10))),
    title(" Recent sessions"),
  ];

  if (sessions.length > 0) {
    const maxGoal = RW - 16;
    for (const s of sessions.slice(0, 3)) {
      const g = s.goal.length > maxGoal ? s.goal.slice(0, maxGoal - 1) + "…" : s.goal;
      right.push(" " + dim(s.id.slice(0, 12)) + " " + g);
    }
  } else {
    right.push(" " + dim("No recent sessions"));
  }
  right.push("");

  // ── Equalise row count ──
  const h = Math.max(left.length, right.length);
  while (left.length < h) left.push("");
  while (right.length < h) right.push("");

  // ── Assemble box ──
  const label = ` sweteam v${VERSION} `;
  const topDashes = Math.max(IW - 3 - label.length, 0);
  const top =
    border("╭───") + title(label) + border("─".repeat(topDashes)) + border("╮");
  const bot = border("╰" + "─".repeat(IW) + "╯");

  const rows: string[] = [top];
  for (let i = 0; i < h; i++) {
    rows.push(
      border("│") +
        rPad(left[i], LW) +
        border("│") +
        rPad(right[i], RW) +
        border("│"),
    );
  }
  rows.push(bot);

  return rows.join("\n");
}
