import chalk from "chalk";
import { vLen, rPad } from "./banner.js";

const border = chalk.blue;
const iconRunning = chalk.blue("▶");
const iconDone = chalk.green("✓");
const iconFailed = chalk.red("✗");

interface AgentSlot {
  id: string;
  label: string;
  role: string;
  status: "running" | "done" | "failed";
  lines: string[];
  /** How many terminal rows the current in-place render occupies. */
  renderedRows: number;
}

export class AgentPanel {
  private slots = new Map<string, AgentSlot>();
  private activeId: string | null = null;
  private maxLines: number;
  private isTTY: boolean;

  constructor(opts?: { maxLines?: number }) {
    this.maxLines = opts?.maxLines ?? 4;
    this.isTTY = !!process.stdout.isTTY;
  }

  addAgent(id: string, role: string, taskId: string, taskTitle: string): void {
    const label = `${role} ─ ${taskId}: ${taskTitle}`;
    const slot: AgentSlot = {
      id,
      label,
      role,
      status: "running",
      lines: [],
      renderedRows: 0,
    };
    this.slots.set(id, slot);
    this.activeId = id;

    if (this.isTTY) {
      this.renderSlot(slot);
    }
  }

  appendOutput(id: string, chunk: string): void {
    const slot = this.slots.get(id);
    if (!slot || slot.status !== "running") return;

    // Split incoming chunk into lines, handling partial lines
    const parts = chunk.split("\n");
    for (const part of parts) {
      const stripped = part.replace(/\r$/, "");
      if (stripped.length > 0) {
        slot.lines.push(stripped);
      }
    }

    // Keep only the last N lines
    if (slot.lines.length > this.maxLines) {
      slot.lines = slot.lines.slice(-this.maxLines);
    }

    if (this.isTTY && this.activeId === id) {
      this.clearRendered(slot);
      this.renderSlot(slot);
    } else if (!this.isTTY) {
      // Non-TTY fallback: prefix-based output
      const parts2 = chunk.split("\n");
      for (const line of parts2) {
        const stripped = line.replace(/\r$/, "");
        if (stripped.length > 0) {
          process.stdout.write(`[${slot.role} ${id}] ${stripped}\n`);
        }
      }
    }
  }

  completeAgent(id: string, success: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.status = success ? "done" : "failed";

    if (this.isTTY) {
      this.clearRendered(slot);
      this.renderSlot(slot);
      // After completing, reset rendered rows so it scrolls up (won't be erased)
      slot.renderedRows = 0;
    } else {
      const icon = success ? "✓" : "✗";
      process.stdout.write(
        `[${slot.role} ${id}] ${icon} ${success ? "done" : "failed"}\n`,
      );
    }

    if (this.activeId === id) {
      this.activeId = null;
    }
  }

  destroy(): void {
    this.slots.clear();
    this.activeId = null;
  }

  // ── Internal rendering ──────────────────────────────────────────

  private getWidth(): number {
    return process.stdout.columns || 80;
  }

  private clearRendered(slot: AgentSlot): void {
    if (slot.renderedRows > 0) {
      // Move cursor up and clear each line
      process.stdout.write(`\x1b[${slot.renderedRows}A`);
      for (let i = 0; i < slot.renderedRows; i++) {
        process.stdout.write("\x1b[2K\n");
      }
      // Move back up to the start
      process.stdout.write(`\x1b[${slot.renderedRows}A`);
    }
  }

  private renderSlot(slot: AgentSlot): void {
    const w = this.getWidth();
    const innerW = w - 2; // space inside the left/right borders
    const rows: string[] = [];

    // Status icon
    let icon: string;
    switch (slot.status) {
      case "running":
        icon = iconRunning;
        break;
      case "done":
        icon = iconDone;
        break;
      case "failed":
        icon = iconFailed;
        break;
    }

    // Top border with label
    const labelText = ` ${icon} ${slot.label} `;
    const labelVisLen = vLen(labelText);
    const dashesAfter = Math.max(0, innerW - 2 - labelVisLen);
    const top =
      border("╭─") + labelText + border("─".repeat(dashesAfter)) + border("╮");
    rows.push(top);

    // Content lines
    const displayLines =
      slot.lines.length > 0 ? slot.lines : ["  (waiting for output...)"];
    for (const line of displayLines) {
      const truncated = this.truncateLine(line, innerW);
      const padded = rPad("  " + truncated, innerW);
      rows.push(border("│") + padded + border("│"));
    }

    // Bottom border
    const bot = border("╰" + "─".repeat(innerW) + "╯");
    rows.push(bot);

    const output = rows.join("\n") + "\n";
    process.stdout.write(output);
    slot.renderedRows = rows.length;
  }

  private truncateLine(line: string, maxVisLen: number): string {
    // Account for the 2-char indent we add
    const available = maxVisLen - 2;
    if (available <= 0) return "";

    const vis = vLen(line);
    if (vis <= available) return line;

    // Simple truncation - strip ANSI, truncate, re-apply would be complex
    // Instead just truncate the raw string and add ellipsis
    // eslint-disable-next-line no-control-regex
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    return plain.slice(0, available - 1) + "…";
  }
}
