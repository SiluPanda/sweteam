/**
 * Heuristics for detecting when a CLI subprocess is waiting for user input.
 */

/** Patterns that indicate the CLI is prompting for input. */
const PROMPT_PATTERNS = [
  /\?\s*$/, // "Do you want to continue? "
  /\(y\/n\)\s*:?\s*$/i, // "(y/n)" or "(y/n):"
  /\[yes\/no\]\s*:?\s*$/i, // "[yes/no]:"
  /\[y\/N\]\s*:?\s*$/i, // "[y/N]"
  /\[Y\/n\]\s*:?\s*$/i, // "[Y/n]"
  /\(yes\/no\)\s*:?\s*$/i, // "(yes/no):"
  /continue\?\s*$/i, // "Do you want to continue?"
  /proceed\?\s*$/i, // "Do you want to proceed?"
  /overwrite\?\s*$/i, // "Overwrite?"
];

/** Patterns that are false positives — output that ends with prompt-like chars but isn't a prompt. */
const FALSE_POSITIVE_PATTERNS = [
  /^#+\s/m, // markdown heading "# ..."
  /^\s*\/\//m, // code comment "// ..."
  /```/, // inside a code block
  /https?:\/\//, // URL
  /^\s*\d+\.\s/m, // numbered list item
  /^\s*-\s/m, // bulleted list
  /[{}[\],;]/, // JSON/code syntax
  /^\s{4,}/, // indented code (4+ spaces)
  /[)\]}>]\s*\?\s*$/, // closing bracket/paren before ? (code pattern)
  /\w+\(\)\s*\?\s*$/, // function call ending with ?
  /[:=]\s*\w+\s*\?\s*$/, // ternary/type annotation with ?
];

/**
 * Detect if the recent output looks like a CLI prompt waiting for input.
 * Only considers the last line of output.
 */
export function detectInputPrompt(recentOutput: string): boolean {
  const trimmed = recentOutput.trimEnd();
  if (!trimmed) return false;

  // Reject binary output — control chars (< 0x20) other than \n \r \t indicate binary data
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0e-\x1f]/.test(trimmed)) return false;

  // Get the last line
  const lines = trimmed.split('\n');
  const lastLine = lines[lines.length - 1];

  // Skip if the last line is clearly not a prompt
  if (!lastLine || lastLine.trim().length === 0) return false;

  // Check false positives on the last line
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    if (fp.test(lastLine)) return false;
  }

  // Check if it matches a prompt pattern
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(lastLine)) return true;
  }

  return false;
}

/**
 * Extract the prompt text from recent output.
 * Returns the last meaningful line (or last few lines if they form a question).
 */
export function extractPromptText(recentOutput: string): string {
  const trimmed = recentOutput.trimEnd();
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) return '';

  // Take the last line as the prompt, but include the preceding line
  // if it looks like it's part of the question (e.g. multi-line prompt)
  const lastLine = lines[lines.length - 1].trim();

  if (lines.length >= 2) {
    const prevLine = lines[lines.length - 2].trim();
    // Include prev line if the last line is short (likely just a prompt char)
    if (lastLine.length < 10 && prevLine.length > 0) {
      return `${prevLine}\n${lastLine}`;
    }
  }

  return lastLine;
}
