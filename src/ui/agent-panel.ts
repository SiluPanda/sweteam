import chalk from "chalk";
import { MarkdownRenderer } from "./markdown.js";

const border = chalk.blue;
const iconRunning = chalk.blue("▶");
const iconDone = chalk.green("✓");
const iconFailed = chalk.red("✗");

interface AgentSlot {
  id: string;
  label: string;
  role: string;
  status: "running" | "done" | "failed";
  /** True when the last chunk didn't end with a newline. */
  midLine: boolean;
  /** Accumulated text for the current incomplete line. */
  lineBuffer: string;
  /** Markdown renderer scoped to this agent's output. */
  renderer: MarkdownRenderer;
}

export class AgentPanel {
  private slots = new Map<string, AgentSlot>();
  private activeId: string | null = null;

  addAgent(id: string, role: string, taskId: string, taskTitle: string): void {
    const label = `${role} ─ ${taskId}: ${taskTitle}`;
    const slot: AgentSlot = {
      id,
      label,
      role,
      status: "running",
      midLine: false,
      lineBuffer: "",
      renderer: new MarkdownRenderer(),
    };
    this.slots.set(id, slot);
    this.activeId = id;

    // Print header
    process.stdout.write(`${iconRunning} ${label}\n`);
    process.stdout.write(border("─".repeat(Math.min(process.stdout.columns || 80, 80))) + "\n");
  }

  appendOutput(id: string, chunk: string): void {
    const slot = this.slots.get(id);
    if (!slot || slot.status !== "running") return;

    const prefix = border("│ ");

    let i = 0;
    while (i < chunk.length) {
      const nlIdx = chunk.indexOf("\n", i);

      if (nlIdx === -1) {
        // No newline remaining — show immediately for streaming feel
        const segment = chunk.slice(i);
        if (segment.length > 0) {
          slot.lineBuffer += segment;
          if (!slot.midLine) {
            process.stdout.write(prefix);
          }
          process.stdout.write(segment);
          slot.midLine = true;
        }
        break;
      }

      // Complete line available
      const segment = chunk.slice(i, nlIdx).replace(/\r$/, "");
      const fullLine = slot.lineBuffer + segment;

      // Always pass through renderer to keep state (code block tracking) in sync
      const renderedLines = slot.renderer.renderLine(fullLine);

      if (slot.midLine) {
        // Already showed partial content raw — just finish the line
        process.stdout.write(segment + "\n");
      } else {
        // Full line arrived at once — show the markdown-rendered version(s)
        for (const rl of renderedLines) {
          process.stdout.write(prefix + rl + "\n");
        }
      }

      slot.lineBuffer = "";
      slot.midLine = false;
      i = nlIdx + 1;
    }
  }

  completeAgent(id: string, success: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.status = success ? "done" : "failed";

    // Flush any partial line
    if (slot.midLine || slot.lineBuffer) {
      process.stdout.write("\n");
      slot.lineBuffer = "";
      slot.midLine = false;
    }

    // Flush any buffered table rows
    const remaining = slot.renderer.flush();
    if (remaining.length > 0) {
      const prefix = border("│ ");
      for (const rl of remaining) {
        process.stdout.write(prefix + rl + "\n");
      }
    }

    // Print footer
    const icon = success ? iconDone : iconFailed;
    const verb = success ? "completed" : "failed";
    process.stdout.write(`${icon} ${slot.role} ${verb}\n\n`);

    if (this.activeId === id) {
      this.activeId = null;
    }
  }

  destroy(): void {
    this.slots.clear();
    this.activeId = null;
  }
}
