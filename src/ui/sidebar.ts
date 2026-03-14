import { listSessionsEnriched, type EnrichedSession } from '../session/manager.js';
import { isLogActive } from '../session/agent-log.js';
import {
  c,
  border,
  box,
  icons,
  progressBar,
  divider,
  vLen,
  rPad,
  vTrunc,
} from './theme.js';

// ── Constants ────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 28;
const CACHE_TTL = 2000; // refresh session data every 2s
const FRAME_MS = 200; // animation frame interval

// ── Helpers ──────────────────────────────────────────────────────────

function elapsed(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// ── Sidebar ──────────────────────────────────────────────────────────

export class SessionSidebar {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private activeId: string | null = null;
  private paused = false;

  // Data cache — avoids querying DB every 200ms
  private cache: EnrichedSession[] = [];
  private cacheTime = 0;

  // Track last rendered dimensions so we can clear the old position on resize
  private lastCols = 0;
  private lastRows = 0;

  private onResize = () => this.handleResize();

  private get iw() {
    return SIDEBAR_WIDTH - 2;
  } // inner width (border + margin)

  get width() {
    return SIDEBAR_WIDTH;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start() {
    if (this.timer) return;
    this.render();
    this.timer = setInterval(() => {
      this.frame++;
      this.render();
    }, FRAME_MS);
    process.stdout.on('resize', this.onResize);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.removeListener('resize', this.onResize);
    this.clear();
  }

  private handleResize() {
    // Clear at the OLD position before rendering at the new one
    this.clearAt(this.lastCols, this.lastRows);
    this.render();
  }

  pause() {
    this.paused = true;
    this.clear();
  }
  resume() {
    this.paused = false;
    this.render();
  }

  setActiveSession(id: string | null) {
    this.activeId = id;
  }

  /** Force a data refresh on next render (e.g. after session create/delete). */
  invalidate() {
    this.cacheTime = 0;
  }

  // ── Data ─────────────────────────────────────────────────────────

  private getSessions(): EnrichedSession[] {
    if (Date.now() - this.cacheTime > CACHE_TTL) {
      try {
        this.cache = listSessionsEnriched();
      } catch {
        this.cache = [];
      }
      this.cacheTime = Date.now();
    }
    return this.cache;
  }

  // ── Status display ───────────────────────────────────────────────

  private icon(status: string, active: boolean): string {
    const sp = icons.spinner[this.frame % icons.spinner.length];
    switch (status) {
      case 'planning':
        return active ? c.info(sp) : c.info('●');
      case 'building':
        return active ? c.warning(sp) : c.warning('●');
      case 'iterating':
        return active ? c.pink(sp) : c.pink('●');
      case 'awaiting_feedback':
        return c.success(icons.pulse[this.frame % icons.pulse.length]);
      case 'stopped':
        return c.error(icons.stopped);
      default:
        return c.dim('○');
    }
  }

  private label(status: string, active: boolean): string {
    switch (status) {
      case 'planning':
        return active ? c.info('planning…') : c.info('planning');
      case 'building':
        return active ? c.warning('building…') : c.warning('building');
      case 'iterating':
        return active ? c.pink('iterating…') : c.pink('iterating');
      case 'awaiting_feedback':
        return c.success('needs feedback');
      case 'stopped':
        return c.error('stopped');
      default:
        return c.dim(status);
    }
  }

  // ── Build lines ──────────────────────────────────────────────────

  private buildLines(): string[] {
    const sessions = this.getSessions();
    const iw = this.iw;
    const lines: string[] = [];

    // Top border
    lines.push(border.dim(box.topLeft + box.horizontal.repeat(iw - 1) + box.topRight));

    // Header
    lines.push(c.primaryBold(` ${icons.building} Sessions`));
    lines.push(divider(iw));

    if (sessions.length === 0) {
      lines.push(c.dim(' (none)'));
      lines.push('');
      lines.push(c.muted(' /create to start'));
      return lines;
    }

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const logActive = isLogActive(s.id);
      const isCurrent = s.id === this.activeId;
      const marker = isCurrent ? c.cyan(icons.pointer) : ' ';
      const ic = this.icon(s.status, logActive);
      const name = (s.repo.split('/').pop() ?? s.id).slice(0, iw - 8);
      const time = c.dim(elapsed(s.updatedAt));

      // Row 1: marker icon name   elapsed
      const nameStr = isCurrent ? c.brightBold(name) : name;
      const row1Left = `${marker}${ic} ${nameStr}`;
      const row1LeftLen = vLen(row1Left);
      const timeLen = vLen(time);
      const gap = Math.max(1, iw - row1LeftLen - timeLen);
      lines.push(vTrunc(row1Left + ' '.repeat(gap) + time, iw));

      // Row 2: status label
      lines.push(vTrunc(`   ${this.label(s.status, logActive)}`, iw));

      // Row 3: progress bar (if building/iterating with tasks)
      if ((s.status === 'building' || s.status === 'iterating') && s.tasksTotal > 0) {
        const barW = Math.min(8, iw - 12);
        lines.push(vTrunc(`   ${progressBar(s.tasksDone, s.tasksTotal, barW)}`, iw));
      }

      // Row 4: goal (truncated)
      if (s.goal) {
        lines.push(vTrunc(`   ${c.dim(s.goal)}`, iw));
      }

      // Separator between sessions (dot separator instead of empty spacer)
      if (i < sessions.length - 1) {
        lines.push(c.muted(` ${icons.dot.repeat(3)}`));
      }
    }

    // Footer
    lines.push(divider(iw));
    const n = sessions.length;
    lines.push(c.muted(` ${n} session${n !== 1 ? 's' : ''}`));

    return lines;
  }

  // ── Render ───────────────────────────────────────────────────────

  render() {
    if (this.paused || !process.stdout.isTTY) return;

    const cols = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
    if (cols < SIDEBAR_WIDTH + 40) return; // too narrow

    this.lastCols = cols;
    this.lastRows = rows;

    const startCol = cols - SIDEBAR_WIDTH + 1;
    const lines = this.buildLines();
    const borderChar = border.dim(box.vertical);

    // Begin synchronized output (prevents tearing in supported terminals)
    let buf = '\x1b[?2026h\x1b7'; // sync on + save cursor

    for (let row = 1; row <= rows; row++) {
      buf += `\x1b[${row};${startCol}H`; // move to position
      if (row <= lines.length) {
        const content = rPad(lines[row - 1], this.iw);
        buf += `${borderChar}${content} `;
      } else {
        buf += `${borderChar}${' '.repeat(this.iw)} `;
      }
    }

    buf += '\x1b8\x1b[?2026l'; // restore cursor + sync off
    process.stdout.write(buf);
  }

  // ── Clear ────────────────────────────────────────────────────────

  private clearAt(cols: number, rows: number) {
    if (!process.stdout.isTTY || cols === 0 || rows === 0) return;
    const startCol = cols - SIDEBAR_WIDTH + 1;
    if (startCol < 1) return;
    const blank = ' '.repeat(SIDEBAR_WIDTH);

    let buf = '\x1b[?2026h\x1b7'; // sync on + save cursor
    for (let row = 1; row <= rows; row++) {
      buf += `\x1b[${row};${startCol}H${blank}`;
    }
    buf += '\x1b8\x1b[?2026l'; // restore cursor + sync off
    process.stdout.write(buf);
  }

  clear() {
    const cols = this.lastCols || (process.stdout.columns ?? 80);
    const rows = this.lastRows || (process.stdout.rows ?? 24);
    this.clearAt(cols, rows);
    this.lastCols = 0;
    this.lastRows = 0;
  }
}
