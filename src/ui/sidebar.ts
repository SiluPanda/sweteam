import chalk from 'chalk';
import { listSessionsEnriched, type EnrichedSession } from '../session/manager.js';
import { isLogActive } from '../session/agent-log.js';

// ── Constants ────────────────────────────────────────────────────────

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const PULSE = ['◆', '◇'];
const SIDEBAR_WIDTH = 28;
const CACHE_TTL = 2000; // refresh session data every 2s
const FRAME_MS = 200; // animation frame interval

// ── Helpers ──────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visLen(s: string): number {
  return stripAnsi(s).length;
}

/** Pad string to `width` visible characters. */
function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visLen(s)));
}

/** Truncate to `max` visible characters, preserving ANSI. */
function trunc(s: string, max: number): string {
  let vis = 0;
  let out = '';
  let esc = false;
  for (const ch of s) {
    if (ch === '\x1b') {
      esc = true;
      out += ch;
      continue;
    }
    if (esc) {
      out += ch;
      if (ch === 'm') esc = false;
      continue;
    }
    if (vis >= max) break;
    out += ch;
    vis++;
  }
  return out;
}

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
    const sp = SPINNER[this.frame % SPINNER.length];
    switch (status) {
      case 'planning':
        return active ? chalk.blue(sp) : chalk.blue('●');
      case 'building':
        return active ? chalk.yellow(sp) : chalk.yellow('●');
      case 'iterating':
        return active ? chalk.magenta(sp) : chalk.magenta('●');
      case 'awaiting_feedback':
        return chalk.green(PULSE[this.frame % PULSE.length]);
      case 'stopped':
        return chalk.red('■');
      default:
        return chalk.dim('○');
    }
  }

  private label(status: string, active: boolean): string {
    switch (status) {
      case 'planning':
        return active ? chalk.blue('planning…') : chalk.blue('planning');
      case 'building':
        return active ? chalk.yellow('building…') : chalk.yellow('building');
      case 'iterating':
        return active ? chalk.magenta('iterating…') : chalk.magenta('iterating');
      case 'awaiting_feedback':
        return chalk.green('needs feedback');
      case 'stopped':
        return chalk.red('stopped');
      default:
        return chalk.dim(status);
    }
  }

  private progressBar(done: number, total: number, w: number): string {
    if (total === 0) return '';
    const filled = Math.round((done / total) * w);
    return (
      chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(w - filled)) + ` ${done}/${total}`
    );
  }

  // ── Build lines ──────────────────────────────────────────────────

  private buildLines(): string[] {
    const sessions = this.getSessions();
    const iw = this.iw;
    const lines: string[] = [];

    // Header
    lines.push(chalk.bold.cyan(' ⚡ Sessions'));
    lines.push(chalk.dim(' ' + '─'.repeat(iw - 1)));

    if (sessions.length === 0) {
      lines.push(chalk.dim(' (none)'));
      lines.push('');
      lines.push(chalk.dim(' /create to start'));
      return lines;
    }

    for (const s of sessions) {
      const logActive = isLogActive(s.id);
      const isCurrent = s.id === this.activeId;
      const marker = isCurrent ? chalk.cyan('▸') : ' ';
      const ic = this.icon(s.status, logActive);
      const name = (s.repo.split('/').pop() ?? s.id).slice(0, iw - 8);
      const time = chalk.dim(elapsed(s.updatedAt));

      // Row 1: marker icon name   elapsed
      const nameStr = isCurrent ? chalk.bold(name) : name;
      const row1Left = `${marker}${ic} ${nameStr}`;
      const row1LeftLen = visLen(row1Left);
      const timeLen = visLen(time);
      const gap = Math.max(1, iw - row1LeftLen - timeLen);
      lines.push(trunc(row1Left + ' '.repeat(gap) + time, iw));

      // Row 2: status label
      lines.push(trunc(`   ${this.label(s.status, logActive)}`, iw));

      // Row 3: progress bar (if building/iterating with tasks)
      if ((s.status === 'building' || s.status === 'iterating') && s.tasksTotal > 0) {
        const barW = Math.min(8, iw - 12);
        lines.push(trunc(`   ${this.progressBar(s.tasksDone, s.tasksTotal, barW)}`, iw));
      }

      // Row 4: goal (truncated)
      if (s.goal) {
        lines.push(trunc(`   ${chalk.dim(s.goal)}`, iw));
      }

      lines.push(''); // spacer
    }

    // Footer
    lines.push(chalk.dim(' ' + '─'.repeat(iw - 1)));
    const n = sessions.length;
    lines.push(chalk.dim(` ${n} session${n !== 1 ? 's' : ''}`));

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
    const border = chalk.dim('│');

    // Begin synchronized output (prevents tearing in supported terminals)
    let buf = '\x1b[?2026h\x1b7'; // sync on + save cursor

    for (let row = 1; row <= rows; row++) {
      buf += `\x1b[${row};${startCol}H`; // move to position
      if (row <= lines.length) {
        const content = pad(lines[row - 1], this.iw);
        buf += `${border}${content} `;
      } else {
        buf += `${border}${' '.repeat(this.iw)} `;
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
