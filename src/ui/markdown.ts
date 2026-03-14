import { c, border, icons } from './theme.js';

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
      this.tableBuffer.push(line);
      return [];
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
      return [
        ...flushed,
        `${olMatch[1]}  ${c.info(olMatch[2] + '.')} ${renderInline(olMatch[3])}`,
      ];
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

  // Calculate column widths, capped at 30 visible chars
  const MAX_COL = 30;
  const colW: number[] = new Array(maxCols).fill(0);
  for (const row of rows) {
    for (let j = 0; j < maxCols; j++) {
      colW[j] = Math.min(MAX_COL, Math.max(colW[j], row[j].length));
    }
  }

  const pad = (s: string, w: number): string => {
    if (s.length > w) return s.slice(0, w - 1) + '…';
    return s.padEnd(w);
  };

  const out: string[] = [];

  // Top border: ┌──┬──┐
  out.push(border.dim('  ┌' + colW.map((w) => '─'.repeat(w + 2)).join('┬') + '┐'));

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((cell, j) => {
      const content = pad(cell, colW[j]);
      // First row is the header — render with brightBold
      return i === 0 ? c.brightBold(content) : renderInline(content);
    });
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
