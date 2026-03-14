import chalk, { type ChalkInstance } from 'chalk';
import gradient from 'gradient-string';

// Respect NO_COLOR convention (https://no-color.org/)
if (process.env['NO_COLOR'] !== undefined) {
  chalk.level = 0;
}

// ── Brand gradient ──────────────────────────────────────────────────
// Used for the main title and key headings
const noColor = process.env['NO_COLOR'] !== undefined;

export const brandGradient: (s: string) => string = noColor ? (s) => s : gradient(['#6366f1', '#8b5cf6', '#a78bfa']);
export const successGradient: (s: string) => string = noColor ? (s) => s : gradient(['#22c55e', '#4ade80']);
export const warningGradient: (s: string) => string = noColor ? (s) => s : gradient(['#f59e0b', '#fbbf24']);

// ── Semantic colors ─────────────────────────────────────────────────
export const c = {
  // Primary palette
  primary: chalk.hex('#818cf8'), // indigo-400
  primaryBold: chalk.bold.hex('#818cf8'),
  primaryDim: chalk.hex('#6366f1'), // indigo-500

  // Secondary
  secondary: chalk.hex('#a78bfa'), // violet-400
  secondaryBold: chalk.bold.hex('#a78bfa'),

  // Semantic
  success: chalk.hex('#4ade80'), // green-400
  successBold: chalk.bold.hex('#4ade80'),
  warning: chalk.hex('#fbbf24'), // amber-400
  warningBold: chalk.bold.hex('#fbbf24'),
  error: chalk.hex('#f87171'), // red-400
  errorBold: chalk.bold.hex('#f87171'),
  info: chalk.hex('#38bdf8'), // sky-400
  infoBold: chalk.bold.hex('#38bdf8'),

  // Neutrals
  muted: chalk.hex('#6b7280'), // gray-500
  dim: chalk.dim,
  subtle: chalk.hex('#9ca3af'), // gray-400
  text: chalk.hex('#e5e7eb'), // gray-200
  bright: chalk.hex('#f9fafb'), // gray-50
  brightBold: chalk.bold.hex('#f9fafb'),

  // Accents
  cyan: chalk.hex('#22d3ee'), // cyan-400
  cyanBold: chalk.bold.hex('#22d3ee'),
  pink: chalk.hex('#f472b6'), // pink-400
  orange: chalk.hex('#fb923c'), // orange-400

  // Styles
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,
  strikethrough: chalk.strikethrough,
} as const;

// ── Borders ─────────────────────────────────────────────────────────
export const border = {
  primary: chalk.hex('#4f46e5'), // indigo-600
  dim: chalk.hex('#374151'), // gray-700
  accent: chalk.hex('#6366f1'), // indigo-500
  success: chalk.hex('#16a34a'), // green-600
  error: chalk.hex('#dc2626'), // red-600
  warning: chalk.hex('#d97706'), // amber-600
} as const;

// ── Box-drawing characters ──────────────────────────────────────────
export const box = {
  // Double-line (primary containers)
  dTopLeft: '╔',
  dTopRight: '╗',
  dBottomLeft: '╚',
  dBottomRight: '╝',
  dHorizontal: '═',
  dVertical: '║',
  dTeeLeft: '╠',
  dTeeRight: '╣',

  // Rounded (secondary containers)
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeLeft: '├',
  teeRight: '┤',
  teeDown: '┬',
  teeUp: '┴',
  cross: '┼',

  // Tree connectors
  treeBranch: '├',
  treeLast: '└',
  treePipe: '│',
} as const;

// ── Icons ───────────────────────────────────────────────────────────
export const icons = {
  // Status
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',
  running: '▶',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  pulse: ['◆', '◇'],

  // Navigation
  arrow: '❯',
  arrowRight: '→',
  arrowDown: '↓',
  pointer: '▸',
  pointerEmpty: '▹',

  // Items
  bullet: '•',
  dash: '─',
  dot: '·',
  star: '★',
  heart: '♥',

  // Session status
  planning: '◈',
  building: '⚡',
  feedback: '◆',
  iterating: '↻',
  stopped: '■',

  // Tasks
  taskDone: '✓',
  taskRunning: '▶',
  taskReviewing: '⟳',
  taskFixing: '⚙',
  taskFailed: '✗',
  taskBlocked: '⊘',
  taskQueued: '○',
} as const;

// ── Progress bar ────────────────────────────────────────────────────
export function progressBar(done: number, total: number, width: number): string {
  if (total === 0) return '';
  const pct = Math.min(1, done / total);
  const filled = Math.round(pct * width);
  const empty = width - filled;

  // Gradient colors based on percentage
  let filledColor: ChalkInstance;
  if (pct < 0.33) filledColor = chalk.hex('#f87171'); // red
  else if (pct < 0.66) filledColor = chalk.hex('#fbbf24'); // amber
  else filledColor = chalk.hex('#4ade80'); // green

  const bar = filledColor('█'.repeat(filled)) + c.muted('░'.repeat(empty));
  const label = c.subtle(`${done}/${total}`);
  return `${bar} ${label}`;
}

// ── Badge (pill-style status labels) ────────────────────────────────
export function badge(text: string, color: ChalkInstance): string {
  return color(`[${text}]`);
}

export function statusBadge(status: string): string {
  switch (status) {
    case 'planning':
      return badge(`${icons.planning} planning`, c.info);
    case 'building':
      return badge(`${icons.building} building`, c.warning);
    case 'iterating':
      return badge(`${icons.iterating} iterating`, c.pink);
    case 'awaiting_feedback':
      return badge(`${icons.feedback} feedback`, c.success);
    case 'stopped':
      return badge(`${icons.stopped} stopped`, c.error);
    default:
      return badge(status, c.muted);
  }
}

// ── Section dividers ────────────────────────────────────────────────
export function divider(width: number, label?: string): string {
  if (!label) {
    return border.dim('─'.repeat(width));
  }
  const labelStr = ` ${label} `;
  const remaining = Math.max(0, width - labelStr.length - 2);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return border.dim('─'.repeat(left + 1)) + c.subtle(labelStr) + border.dim('─'.repeat(right + 1));
}

export function doubleDivider(width: number, label?: string): string {
  if (!label) {
    return border.primary('═'.repeat(width));
  }
  const labelStr = ` ${label} `;
  const remaining = Math.max(0, width - labelStr.length - 2);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return (
    border.primary('═'.repeat(left + 1)) +
    c.primaryBold(labelStr) +
    border.primary('═'.repeat(right + 1))
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Visible length of a string after stripping ANSI escape codes. */
export function vLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length;
}

/** Pad string to `w` visible characters (right-pad with spaces). */
export function rPad(s: string, w: number): string {
  const diff = w - vLen(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

/** Truncate to `max` visible characters, preserving ANSI codes. */
export function vTrunc(s: string, max: number): string {
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
      if (/[A-Za-z]/.test(ch)) esc = false;
      continue;
    }
    if (vis >= max) break;
    out += ch;
    vis++;
  }
  return out;
}

/** Strip ANSI escape codes from a string. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}
