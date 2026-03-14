import { c, border, icons, vLen, vTrunc } from './theme.js';

/**
 * Streaming-friendly markdown renderer for terminal output.
 * Processes one line at a time, tracking state across lines
 * (e.g. code block boundaries, table accumulation).
 */
export class MarkdownRenderer {
  private inCodeBlock = false;
  private tableBuffer: string[] = [];

  /**
   * Render a single input line. Returns an array of rendered lines.
   * May return an empty array when buffering table rows (the table
   * is emitted once a non-table line arrives or flush() is called).
   */
  renderLine(line: string): string[] {
    // Code block toggle: ```lang or ```
    if (/^\s*```/.test(line)) {
      const flushed = this.flushTable();
      this.inCodeBlock = !this.inCodeBlock;
      if (this.inCodeBlock) {
        const lang = line.replace(/^\s*```/, '').trim();
        if (lang) {
          const ruleLen = Math.max(0, 36 - lang.length);
          return [
            ...flushed,
            '  ' + border.dim('──') + c.info(` ${lang} `) + border.dim('─'.repeat(ruleLen)),
          ];
        }
        return [...flushed, '  ' + border.dim('─'.repeat(42))];
      }
      return [...flushed, '  ' + border.dim('─'.repeat(42))];
    }

    // Inside code block — show with subtle color and a gutter
    if (this.inCodeBlock) {
      return [c.subtle(`  ${line}`)];
    }

    // Table row: buffer lines that look like | … | for batch rendering
    if (isTableRow(line)) {
      // Flush incrementally if buffer exceeds max size to bound memory usage
      const flushedRows = this.tableBuffer.length >= 500 ? this.flushTable() : [];
      this.tableBuffer.push(line);
      return flushedRows;
    }

    // Non-table line — flush any buffered table first
    const flushed = this.flushTable();

    // Heading: # … through ######
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = renderInline(headerMatch[2]);
      if (level === 1) return [...flushed, '\n' + c.brightBold(c.underline(text))];
      if (level === 2) return [...flushed, '\n' + c.primaryBold(text)];
      return [...flushed, c.bold(text)];
    }

    // Horizontal rule: --- / *** / ___
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      return [...flushed, c.muted('· '.repeat(20))];
    }

    // Blockquote: > text
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      return [...flushed, c.primary('  │ ') + renderInline(bqMatch[1])];
    }

    // Unordered list item: - / * / + followed by space
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      return [...flushed, `${ulMatch[1]}  ${c.info(icons.bullet)} ${renderInline(ulMatch[2])}`];
    }

    // Ordered list item: 1. text
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      return [...flushed, `${olMatch[1]}  ${c.info(olMatch[2] + '.')} ${renderInline(olMatch[3])}`];
    }

    // Regular line — just apply inline formatting
    return [...flushed, renderInline(line)];
  }

  /** Flush any buffered table rows. Call when agent output ends. */
  flush(): string[] {
    return this.flushTable();
  }

  private flushTable(): string[] {
    if (this.tableBuffer.length === 0) return [];
    const lines = renderTable(this.tableBuffer);
    this.tableBuffer = [];
    return lines;
  }
}

/* ── Table helpers ─────────────────────────────────────────────── */

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  // Must contain pipes and start/end with a pipe (standard markdown table row)
  return /^\|.*\|$/.test(trimmed) && trimmed.length > 2;
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

function parseCells(line: string): string[] {
  const cells = line
    .trim()
    .split('|')
    .map((c) => c.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function renderTable(bufferedLines: string[]): string[] {
  // Separate header and data rows (skip separator rows)
  const rows: string[][] = [];
  for (const line of bufferedLines) {
    if (isSeparatorRow(line)) continue;
    const cells = parseCells(line);
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return bufferedLines; // fallback to raw lines

  // Normalise column count
  const maxCols = Math.max(...rows.map((r) => r.length));
  for (const row of rows) {
    while (row.length < maxCols) row.push('');
  }

  // Apply inline formatting first, then measure visible widths
  const styledRows: string[][] = rows.map((row, i) =>
    row.map((cell) => (i === 0 ? c.brightBold(cell) : renderInline(cell))),
  );

  // Calculate column widths based on visible length, capped at 30 chars
  const MAX_COL = 30;
  const colW: number[] = new Array(maxCols).fill(0);
  for (const row of styledRows) {
    for (let j = 0; j < maxCols; j++) {
      colW[j] = Math.min(MAX_COL, Math.max(colW[j], vLen(row[j])));
    }
  }

  // Pad or truncate based on visible width, preserving ANSI codes
  const pad = (s: string, w: number): string => {
    const visible = vLen(s);
    if (visible > w) return vTrunc(s, w - 1) + '…';
    return s + ' '.repeat(w - visible);
  };

  const out: string[] = [];

  // Top border: ┌──┬──┐
  out.push(border.dim('  ┌' + colW.map((w) => '─'.repeat(w + 2)).join('┬') + '┐'));

  for (let i = 0; i < styledRows.length; i++) {
    const cells = styledRows[i].map((cell, j) => pad(cell, colW[j]));
    out.push(
      border.dim('  │') + cells.map((cell) => ` ${cell} `).join(border.dim('│')) + border.dim('│'),
    );

    // Separator after header: ├──┼──┤
    if (i === 0) {
      out.push(border.dim('  ├' + colW.map((w) => '─'.repeat(w + 2)).join('┼') + '┤'));
    }
  }

  // Bottom border: └──┴──┘
  out.push(border.dim('  └' + colW.map((w) => '─'.repeat(w + 2)).join('┴') + '┘'));

  return out;
}

/* ── Inline formatting ─────────────────────────────────────────── */

/**
 * Apply inline markdown formatting to a single line of text.
 * Order matters: code spans first (to protect their contents),
 * then bold, then italic.
 */
function renderInline(text: string): string {
  // Protect inline code spans from other transforms
  const codeSpans: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(c.cyan(code));
    return `\x00C${codeSpans.length - 1}\x00`;
  });

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, (_, p1) => c.bold(p1));
  text = text.replace(/__(.+?)__/g, (_, p1) => c.bold(p1));

  // Italic: *text* (single asterisk, not preceded/followed by *)
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, p1) => c.italic(p1));

  // Restore protected code spans
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\x00C(\d+)\x00/g, (_, idx) => codeSpans[parseInt(idx)]);

  return text;
}
