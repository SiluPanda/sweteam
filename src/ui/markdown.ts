import chalk from "chalk";

/**
 * Streaming-friendly markdown renderer for terminal output.
 * Processes one line at a time, tracking state across lines
 * (e.g. code block boundaries).
 */
export class MarkdownRenderer {
  private inCodeBlock = false;

  renderLine(line: string): string {
    // Code block toggle: ```lang or ```
    if (/^\s*```/.test(line)) {
      this.inCodeBlock = !this.inCodeBlock;
      if (this.inCodeBlock) {
        const lang = line.replace(/^\s*```/, "").trim();
        const label = lang ? ` ${lang} ` : "";
        const ruleLen = Math.max(0, 40 - label.length);
        return chalk.dim(`  ${"─".repeat(2)}${label}${"─".repeat(ruleLen)}`);
      }
      return chalk.dim(`  ${"─".repeat(42)}`);
    }

    // Inside code block — show dimmed with a gutter
    if (this.inCodeBlock) {
      return chalk.dim(`  ${line}`);
    }

    // Heading: # … through ######
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = renderInline(headerMatch[2]);
      if (level === 1) return "\n" + chalk.bold.underline(text);
      if (level === 2) return "\n" + chalk.bold(text);
      return chalk.bold(text);
    }

    // Horizontal rule: --- / *** / ___
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      return chalk.dim("─".repeat(40));
    }

    // Blockquote: > text
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      return chalk.dim("  │ ") + renderInline(bqMatch[1]);
    }

    // Unordered list item: - / * / + followed by space
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      return `${ulMatch[1]}  ${chalk.dim("•")} ${renderInline(ulMatch[2])}`;
    }

    // Ordered list item: 1. text
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      return `${olMatch[1]}  ${chalk.dim(olMatch[2] + ".")} ${renderInline(olMatch[3])}`;
    }

    // Regular line — just apply inline formatting
    return renderInline(line);
  }
}

/**
 * Apply inline markdown formatting to a single line of text.
 * Order matters: code spans first (to protect their contents),
 * then bold, then italic.
 */
function renderInline(text: string): string {
  // Protect inline code spans from other transforms
  const codeSpans: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(chalk.cyan(code));
    return `\x00C${codeSpans.length - 1}\x00`;
  });

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, (_, p1) => chalk.bold(p1));
  text = text.replace(/__(.+?)__/g, (_, p1) => chalk.bold(p1));

  // Italic: *text* (single asterisk, not preceded/followed by *)
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, p1) => chalk.italic(p1));

  // Restore protected code spans
  text = text.replace(/\x00C(\d+)\x00/g, (_, idx) => codeSpans[parseInt(idx)]);

  return text;
}
