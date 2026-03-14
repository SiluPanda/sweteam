import { createInterface } from 'readline';
import { c, icons, vLen } from './theme.js';

/**
 * Interactive prompt with dropdown autocomplete and ghost-text.
 *
 * When completions are available, a dropdown list renders below the
 * prompt line.  The user can navigate with Up/Down arrows and accept
 * with Tab.  Ghost text (fish-shell style) also shows the highlighted
 * match inline.
 *
 * - Tab        Accept the highlighted suggestion
 * - Up/Down    Navigate the dropdown
 * - Right arrow Accept one ghost character (fish-style)
 * - Enter      Submit the current input
 * - Escape     Dismiss the dropdown
 * - Ctrl-C     Exit
 */

/** Sentinel value returned by promptLine when the user presses Escape to back out. */
export const ESCAPE_SIGNAL = '\x1b__ESCAPE__';

export interface PromptOptions {
  prompt: string;
  /** Returns matching completions for the current input. */
  getCompletions: (input: string) => string[];
  /** Number of columns reserved on the right (e.g. sidebar). Input will not overflow into them. */
  reservedRight?: number;
}

export function promptLine(opts: PromptOptions): Promise<string> {
  const { prompt, getCompletions, reservedRight = 0 } = opts;

  return new Promise<string>((resolve) => {
    let input = '';
    let cursor = 0;
    let suggestions: string[] = [];
    let selectedIndex = 0;
    let dropdownRows = 0; // how many rows the dropdown currently occupies

    /** Usable columns for prompt content (terminal width minus reserved sidebar). */
    function usableWidth(): number {
      const cols = process.stdout.columns ?? 80;
      return Math.max(20, cols - reservedRight);
    }

    // ── rendering ────────────────────────────────────────────────

    function clearDropdown() {
      if (dropdownRows > 0) {
        // Move below the prompt line and clear each dropdown row
        for (let i = 0; i < dropdownRows; i++) {
          process.stdout.write('\n\x1b[2K');
        }
        // Move back up to the prompt line
        process.stdout.write(`\x1b[${dropdownRows}A`);
        dropdownRows = 0;
      }
    }

    function render() {
      // Clear previous dropdown first
      clearDropdown();

      const width = usableWidth();
      const promptLen = vLen(prompt);
      const inputSpace = width - promptLen;

      // When input is longer than available space, show a sliding window around the cursor
      const inputChars = Array.from(input);
      let visibleInput = input;
      let visibleCursor = cursor;
      if (inputChars.length > inputSpace) {
        // Keep cursor roughly centered in the visible window
        let start = cursor - Math.floor(inputSpace / 2);
        start = Math.max(0, Math.min(start, inputChars.length - inputSpace));
        visibleInput = inputChars.slice(start, start + inputSpace).join('');
        visibleCursor = cursor - start;
      }

      // Clear the prompt line and redraw
      process.stdout.write(`\r\x1b[2K${prompt}${visibleInput}`);

      // Show ghost text for the selected match (only if room)
      const selected = suggestions[selectedIndex];
      if (selected && selected.startsWith(input) && selected.length > input.length) {
        const ghostRoom = width - promptLen - visibleInput.length;
        if (ghostRoom > 0) {
          const ghost = selected.slice(input.length, input.length + ghostRoom);
          process.stdout.write(c.muted(ghost));
        }
      }

      // Draw dropdown below the prompt line
      if (suggestions.length > 0) {
        const maxVisible = Math.min(suggestions.length, 8);
        for (let i = 0; i < maxVisible; i++) {
          const item = suggestions[i];
          const truncItem = item.length > width - 3 ? item.slice(0, width - 6) + '…' : item;
          if (i === selectedIndex) {
            process.stdout.write('\n' + c.cyan(`${icons.arrow} `) + c.brightBold(truncItem));
          } else {
            process.stdout.write('\n  ' + c.subtle(truncItem));
          }
        }
        if (suggestions.length > maxVisible) {
          process.stdout.write('\n ' + c.muted(`… ${suggestions.length - maxVisible} more`));
          dropdownRows = maxVisible + 1;
        } else {
          dropdownRows = maxVisible;
        }
        // Move cursor back up to the prompt line
        process.stdout.write(`\x1b[${dropdownRows}A`);
      }

      // Park cursor at end of user's actual input (before ghost)
      process.stdout.write(`\r\x1b[${promptLen + visibleCursor}C`);
    }

    function refreshSuggestions() {
      suggestions = getCompletions(input);
      selectedIndex = 0;
    }

    // ── lifecycle ───────────────────────────────────────────────

    function finish(value: string) {
      clearDropdown();
      if (value === ESCAPE_SIGNAL) {
        // Escape — clear the prompt line cleanly, no echo
        process.stdout.write(`\r\x1b[2K`);
      } else {
        process.stdout.write(`\r\x1b[2K${prompt}${value}\n`);
      }
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      resolve(value);
    }

    // ── key handling ────────────────────────────────────────────

    function acceptSuggestion() {
      if (suggestions.length > 0) {
        input = suggestions[selectedIndex] + ' ';
        cursor = input.length;
        refreshSuggestions();
        render();
      }
    }

    function onData(raw: Buffer) {
      const seq = raw.toString('utf8');

      // ── Enter: submit ──
      if (seq === '\r' || seq === '\n') {
        finish(input);
        return;
      }

      // ── Ctrl-C / Ctrl-D ──
      if (seq === '\x03' || seq === '\x04') {
        finish('');
        return;
      }

      // ── Tab: accept suggestion ──
      if (seq === '\t') {
        acceptSuggestion();
        return;
      }

      // ── Right arrow ──
      if (seq === '\x1b[C') {
        if (cursor === input.length && suggestions.length > 0) {
          // At end of input: accept one ghost character (fish-style)
          const match = suggestions[selectedIndex];
          if (match && match.length > input.length) {
            input = match.slice(0, input.length + 1);
            cursor = input.length;
            refreshSuggestions();
            render();
          }
        } else if (cursor < input.length) {
          cursor++;
          render();
        }
        return;
      }

      // ── Left arrow ──
      if (seq === '\x1b[D') {
        if (cursor > 0) {
          cursor--;
          render();
        }
        return;
      }

      // ── Down arrow: move selection down ──
      if (seq === '\x1b[B') {
        if (suggestions.length > 0) {
          selectedIndex = (selectedIndex + 1) % suggestions.length;
          render();
        }
        return;
      }

      // ── Up arrow: move selection up ──
      if (seq === '\x1b[A') {
        if (suggestions.length > 0) {
          selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
          render();
        }
        return;
      }

      // ── Escape: dismiss dropdown, or back out if nothing to dismiss ──
      if (seq === '\x1b') {
        if (suggestions.length > 0) {
          // Dropdown is open — just dismiss it
          suggestions = [];
          selectedIndex = 0;
          render();
        } else if (input === '') {
          // Nothing typed, no dropdown — signal "back out"
          finish(ESCAPE_SIGNAL);
        } else {
          // Has typed text — clear the input first
          input = '';
          cursor = 0;
          refreshSuggestions();
          render();
        }
        return;
      }

      // ── Backspace ──
      if (seq === '\x7f' || seq === '\b') {
        if (cursor > 0) {
          const chars = Array.from(input);
          chars.splice(cursor - 1, 1);
          input = chars.join('');
          cursor--;
          refreshSuggestions();
          render();
        }
        return;
      }

      // ── Ignore other escape / control sequences ──
      if (seq.startsWith('\x1b') || seq.charCodeAt(0) < 32) {
        return;
      }

      // ── Printable characters (including paste) ──
      // Use Array.from to correctly iterate over code points (handles surrogate pairs)
      for (const ch of Array.from(seq)) {
        const chars = Array.from(input);
        chars.splice(cursor, 0, ch);
        input = chars.join('');
        cursor++;
      }
      refreshSuggestions();
      render();
    }

    // ── start ───────────────────────────────────────────────────

    if (!process.stdin.isTTY) {
      // Non-TTY mode (piped input): read line-by-line via readline
      process.stdout.write(prompt);
      const rl = createInterface({ input: process.stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
      rl.once('close', () => resolve(''));
      return;
    }

    process.stdin.setRawMode(true);
    try {
      process.stdin.resume();
      process.stdin.on('data', onData);
      render();
    } catch (err) {
      // Ensure raw mode is disabled if setup throws
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      throw err;
    }
  });
}
