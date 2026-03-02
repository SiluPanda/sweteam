import chalk from "chalk";

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

    // Process chunk character-by-character for correct line handling
    let i = 0;
    while (i < chunk.length) {
      const nlIdx = chunk.indexOf("\n", i);

      if (nlIdx === -1) {
        // No more newlines — partial line
        const segment = chunk.slice(i);
        if (segment.length > 0) {
          if (!slot.midLine) {
            process.stdout.write(prefix);
          }
          process.stdout.write(segment);
          slot.midLine = true;
        }
        break;
      }

      // There's a newline at nlIdx
      const segment = chunk.slice(i, nlIdx).replace(/\r$/, "");
      if (!slot.midLine) {
        process.stdout.write(prefix);
      }
      process.stdout.write(segment + "\n");
      slot.midLine = false;
      i = nlIdx + 1;
    }
  }

  completeAgent(id: string, success: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.status = success ? "done" : "failed";

    // Flush any partial line
    if (slot.midLine) {
      process.stdout.write("\n");
      slot.midLine = false;
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
