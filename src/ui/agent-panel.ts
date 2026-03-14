import { MarkdownRenderer } from './markdown.js';
import { c, border, box, icons } from './theme.js';

interface AgentSlot {
  id: string;
  label: string;
  role: string;
  status: 'running' | 'done' | 'failed';
  /** True when the last chunk didn't end with a newline. */
  midLine: boolean;
  /** Accumulated text for the current incomplete line. */
  lineBuffer: string;
  /** Markdown renderer scoped to this agent's output. */
  renderer: MarkdownRenderer;
  /** Width of the header box (for the matching footer). */
  boxWidth: number;
}

export class AgentPanel {
  private slots = new Map<string, AgentSlot>();
  private activeId: string | null = null;

  addAgent(id: string, role: string, taskId: string, taskTitle: string): void {
    const maxWidth = Math.min(process.stdout.columns || 80, 80);

    // Build inner content: ─ role ─── task-id: title ─
    const roleStr = ` ${role} `;
    const taskStr = ` ${taskId}: ${taskTitle} `;
    // 2 corners + at least 1 dash on each side of role + 3 dashes between role and task
    const fixedChrome = 2 + 1 + roleStr.length + 3 + taskStr.length + 1;
    const trailingDashes = Math.max(1, maxWidth - fixedChrome);
    const boxWidth = fixedChrome + trailingDashes;

    const headerLine =
      border.accent(box.topLeft + box.horizontal) +
      c.secondaryBold(roleStr) +
      border.accent(box.horizontal.repeat(3)) +
      c.subtle(taskStr) +
      border.accent(box.horizontal.repeat(trailingDashes) + box.topRight);

    const label = `${role} ${box.horizontal} ${taskId}: ${taskTitle}`;
    const slot: AgentSlot = {
      id,
      label,
      role,
      status: 'running',
      midLine: false,
      lineBuffer: '',
      renderer: new MarkdownRenderer(),
      boxWidth,
    };
    this.slots.set(id, slot);
    this.activeId = id;

    // Print header
    process.stdout.write(headerLine + '\n');
  }

  appendOutput(id: string, chunk: string): void {
    const slot = this.slots.get(id);
    if (!slot || slot.status !== 'running') return;

    const prefix = border.accent(box.vertical) + ' ';

    let i = 0;
    while (i < chunk.length) {
      const nlIdx = chunk.indexOf('\n', i);

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
      const segment = chunk.slice(i, nlIdx).replace(/\r$/, '');
      const fullLine = slot.lineBuffer + segment;

      // Always pass through renderer to keep state (code block tracking) in sync
      const renderedLines = slot.renderer.renderLine(fullLine);

      if (slot.midLine) {
        // Already showed partial content raw — just finish the line
        process.stdout.write(segment + '\n');
      } else {
        // Full line arrived at once — show the markdown-rendered version(s)
        for (const rl of renderedLines) {
          process.stdout.write(prefix + rl + '\n');
        }
      }

      slot.lineBuffer = '';
      slot.midLine = false;
      i = nlIdx + 1;
    }
  }

  completeAgent(id: string, success: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.status = success ? 'done' : 'failed';

    // Flush any partial line
    if (slot.midLine || slot.lineBuffer) {
      process.stdout.write('\n');
      slot.lineBuffer = '';
      slot.midLine = false;
    }

    // Flush any buffered table rows
    const remaining = slot.renderer.flush();
    if (remaining.length > 0) {
      const prefix = border.accent(box.vertical) + ' ';
      for (const rl of remaining) {
        process.stdout.write(prefix + rl + '\n');
      }
    }

    // Print footer status line
    const statusLine = success
      ? c.success(icons.success) + ' ' + c.secondaryBold(slot.role) + ' ' + c.subtle('completed')
      : c.error(icons.error) + ' ' + c.secondaryBold(slot.role) + ' ' + c.error('failed');
    const statusPrefix = border.accent(box.vertical) + ' ';
    process.stdout.write(statusPrefix + statusLine + '\n');

    // Print bottom border
    const innerWidth = Math.max(0, slot.boxWidth - 2);
    const bottomLine = border.accent(
      box.bottomLeft + box.horizontal.repeat(innerWidth) + box.bottomRight,
    );
    process.stdout.write(bottomLine + '\n\n');

    if (this.activeId === id) {
      this.activeId = null;
    }
  }

  destroy(): void {
    this.slots.clear();
    this.activeId = null;
  }
}
