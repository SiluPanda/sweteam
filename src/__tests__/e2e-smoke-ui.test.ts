import { describe, it, expect } from 'vitest';
import { vLen, vTrunc, stripAnsi } from '../ui/theme.js';
import { MarkdownRenderer } from '../ui/markdown.js';

/* ── 1. vLen() with non-SGR ANSI sequences ─────────────────────── */

describe('vLen() — non-SGR ANSI stripping', () => {
  it('strips cursor-up movement (CSI 2A)', () => {
    const s = 'hello\x1b[2Aworld';
    expect(vLen(s)).toBe(10); // "helloworld"
  });

  it('strips erase-line (CSI 2K)', () => {
    const s = 'foo\x1b[2Kbar';
    expect(vLen(s)).toBe(6); // "foobar"
  });

  it('strips DEC private mode set (CSI ?25h — show cursor)', () => {
    const s = '\x1b[?25hvisible';
    expect(vLen(s)).toBe(7); // "visible"
  });

  it('strips DEC private mode reset (CSI ?25l — hide cursor)', () => {
    const s = '\x1b[?25linvisible';
    expect(vLen(s)).toBe(9); // "invisible"
  });

  it('strips SGR codes (CSI …m) as before', () => {
    const s = '\x1b[1;31mred bold\x1b[0m';
    expect(vLen(s)).toBe(8); // "red bold"
  });

  it('handles multiple mixed non-SGR and SGR sequences', () => {
    const s = '\x1b[2K\x1b[1;32mOK\x1b[0m\x1b[?25h';
    expect(vLen(s)).toBe(2); // "OK"
  });

  it('returns 0 for a string of only ANSI codes', () => {
    const s = '\x1b[2K\x1b[1A\x1b[?25l';
    expect(vLen(s)).toBe(0);
  });
});

/* ── 2. vTrunc() with non-SGR ANSI sequences ───────────────────── */

describe('vTrunc() — non-SGR ANSI preservation', () => {
  it('preserves all visible characters when escape is mid-string', () => {
    const s = 'hello\x1b[2Kworld';
    const truncated = vTrunc(s, 10);
    // All 10 visible chars should survive; ANSI code is preserved too
    expect(vLen(truncated)).toBe(10);
    expect(stripAnsi(truncated)).toBe('helloworld');
  });

  it('truncates correctly with non-SGR escape in the middle', () => {
    const s = 'hello\x1b[2Kworld';
    const truncated = vTrunc(s, 7);
    expect(vLen(truncated)).toBe(7);
    expect(stripAnsi(truncated)).toBe('hellowo');
  });

  it('preserves non-SGR sequences that appear before the cut point', () => {
    const s = 'ab\x1b[?25hcd';
    const truncated = vTrunc(s, 3);
    expect(vLen(truncated)).toBe(3);
    expect(stripAnsi(truncated)).toBe('abc');
  });

  it('handles cursor-movement escape at the very end', () => {
    const s = 'test\x1b[1A';
    const truncated = vTrunc(s, 4);
    expect(vLen(truncated)).toBe(4);
    expect(stripAnsi(truncated)).toBe('test');
  });
});

/* ── 3. vLen/vTrunc consistency ─────────────────────────────────── */

describe('vLen/vTrunc consistency', () => {
  const testCases = [
    { label: 'SGR only', s: '\x1b[1;31mhello\x1b[0m \x1b[4mworld\x1b[0m' },
    { label: 'non-SGR only', s: 'foo\x1b[2Kbar\x1b[1Abaz' },
    { label: 'mixed SGR + non-SGR', s: '\x1b[2K\x1b[1;36mcyan\x1b[0m\x1b[?25h done' },
    { label: 'plain text', s: 'no escapes here' },
    { label: 'empty string', s: '' },
    { label: 'nested codes', s: '\x1b[1m\x1b[2K\x1b[31mred\x1b[0m\x1b[?25l' },
  ];

  for (const { label, s } of testCases) {
    it(`vTrunc(str, vLen(str)) preserves vLen — ${label}`, () => {
      const len = vLen(s);
      const result = vTrunc(s, len);
      expect(vLen(result)).toBe(len);
    });
  }

  it('partial truncation always produces correct vLen', () => {
    const s = '\x1b[1;32mhello\x1b[0m \x1b[2Kworld';
    const fullLen = vLen(s);
    for (let n = 0; n <= fullLen; n++) {
      const truncated = vTrunc(s, n);
      expect(vLen(truncated)).toBe(n);
    }
  });
});

/* ── 4. stripAnsi() consistency with vLen ───────────────────────── */

describe('stripAnsi() consistency with vLen', () => {
  const cases = [
    '\x1b[1;31mhello\x1b[0m',
    '\x1b[2Kfoo',
    '\x1b[?25hbar',
    '\x1b[1A\x1b[2Kbaz\x1b[0m',
    'plain',
    '',
  ];

  for (const s of cases) {
    it(`stripAnsi length equals vLen for: ${JSON.stringify(s)}`, () => {
      expect(stripAnsi(s).length).toBe(vLen(s));
    });
  }

  it('stripAnsi result contains no ANSI escapes', () => {
    const s = '\x1b[2K\x1b[1;32mhello\x1b[0m\x1b[?25h';
    const stripped = stripAnsi(s);
    // eslint-disable-next-line no-control-regex
    expect(stripped).not.toMatch(/\x1b/);
  });

  it('stripAnsi is idempotent', () => {
    const s = '\x1b[2K\x1b[1;32mhello\x1b[0m';
    expect(stripAnsi(stripAnsi(s))).toBe(stripAnsi(s));
  });
});

/* ── 5. Markdown table rendering — column width consistency ─────── */

describe('MarkdownRenderer — table column widths', () => {
  it('renders a table with bold/code cells at consistent column widths', () => {
    const renderer = new MarkdownRenderer();

    // Feed markdown table rows
    const tableLines = [
      '| Name       | Status   | Notes        |',
      '|------------|----------|--------------|',
      '| **alpha**  | `done`   | first entry  |',
      '| beta       | `wip`    | second entry |',
      '| **gamma**  | `done`   | third entry  |',
    ];

    const output: string[] = [];
    for (const line of tableLines) {
      output.push(...renderer.renderLine(line));
    }
    // Flush remaining buffered rows
    output.push(...renderer.flush());

    // Filter to data rows (lines containing cells, not border lines)
    const dataRows = output.filter((l) => {
      const stripped = stripAnsi(l).trim();
      return stripped.startsWith('│') && !stripped.match(/^[│┌┬┐├┼┤└┴┘─]+$/);
    });

    expect(dataRows.length).toBeGreaterThanOrEqual(3); // header + 3 data rows

    // All data rows should have the same visible length
    const lengths = dataRows.map((r) => vLen(r));
    const firstLen = lengths[0];
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBe(firstLen);
    }
  });

  it('handles an empty table gracefully', () => {
    const renderer = new MarkdownRenderer();
    const output = renderer.flush();
    expect(output).toEqual([]);
  });

  it('flushes table when a non-table line arrives', () => {
    const renderer = new MarkdownRenderer();
    renderer.renderLine('| A | B |');
    renderer.renderLine('|---|---|');
    renderer.renderLine('| 1 | 2 |');

    // Non-table line triggers flush
    const out = renderer.renderLine('plain text');
    // Should contain both the flushed table rows and the plain text
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});

/* ── 6. Table buffer flush — large table ────────────────────────── */

describe('MarkdownRenderer — large table buffer flush', () => {
  it('renders 600+ rows without error and produces output', () => {
    const renderer = new MarkdownRenderer();

    // Generate a large table
    const rows: string[] = [];
    rows.push('| idx | value |');
    rows.push('|-----|-------|');
    for (let i = 0; i < 600; i++) {
      rows.push(`| ${i} | val-${i} |`);
    }

    const allOutput: string[] = [];
    for (const line of rows) {
      allOutput.push(...renderer.renderLine(line));
    }
    allOutput.push(...renderer.flush());

    // Should have produced output (borders + data rows)
    expect(allOutput.length).toBeGreaterThan(0);

    // Should contain content from early and late rows
    const joined = allOutput.join('\n');
    const stripped = stripAnsi(joined);
    expect(stripped).toContain('0');
    expect(stripped).toContain('599');
  });

  it('triggers incremental flush at 500-row boundary', () => {
    const renderer = new MarkdownRenderer();

    // Buffer exactly 500 rows, then add one more — should trigger flush
    const header = '| col |';
    const sep = '|-----|';
    const earlyFlush: string[] = [];

    // Feed header + separator + 498 data rows = 500 table lines
    renderer.renderLine(header);
    renderer.renderLine(sep);
    for (let i = 0; i < 498; i++) {
      const out = renderer.renderLine(`| ${i} |`);
      earlyFlush.push(...out);
    }

    // At 500 buffered lines, no incremental flush yet (buffer size == 500, threshold is >=500)
    // The next renderLine should see buffer.length >= 500 and trigger flush
    const flushResult = renderer.renderLine('| 498 |');

    // The incremental flush should have returned rendered rows
    expect(flushResult.length).toBeGreaterThan(0);
  });
});
