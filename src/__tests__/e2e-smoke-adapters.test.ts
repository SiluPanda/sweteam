import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectInputPrompt } from '../adapters/prompt-detection.js';

describe('E2E smoke — adapter fixes', () => {
  // ─── 1. Binary data rejection ───────────────────────────────────────
  describe('prompt detection — binary data rejection', () => {
    it('rejects data containing null byte (\\x00)', () => {
      expect(detectInputPrompt('binary\x00data?')).toBe(false);
    });

    it('rejects data with control chars \\x01\\x02\\x03', () => {
      expect(detectInputPrompt('garbage\x01\x02\x03?')).toBe(false);
    });

    it('still detects normal text ending with ?', () => {
      expect(detectInputPrompt('Do you want to continue?')).toBe(true);
    });

    it('returns false for normal text ending with .', () => {
      expect(detectInputPrompt('Task completed successfully.')).toBe(false);
    });
  });

  // ─── 2. Code false positives ────────────────────────────────────────
  describe('prompt detection — code false positives', () => {
    it('rejects type annotation "Dict[str, Any]?"', () => {
      expect(detectInputPrompt('Dict[str, Any]?')).toBe(false);
    });

    it('rejects function call "isValid()?"', () => {
      expect(detectInputPrompt('isValid()?')).toBe(false);
    });

    it('rejects ternary "result = value ? true : false"', () => {
      expect(detectInputPrompt('result = value ? true : false')).toBe(false);
    });

    it('rejects closing bracket before ? "items.map(x => x.id)?"', () => {
      expect(detectInputPrompt('items.map(x => x.id)?')).toBe(false);
    });
  });

  // ─── 3. Real prompts ───────────────────────────────────────────────
  describe('prompt detection — real prompts', () => {
    it('detects "Do you want to continue?"', () => {
      expect(detectInputPrompt('Do you want to continue?')).toBe(true);
    });

    it('detects "(y/n) "', () => {
      expect(detectInputPrompt('(y/n) ')).toBe(true);
    });
  });

  // ─── 4. CustomAdapter temp file uniqueness ─────────────────────────
  describe('CustomAdapter temp file uniqueness', () => {
    it('uses crypto.randomUUID() for temp file names, not Date.now()', () => {
      const src = readFileSync(
        join(__dirname, '..', 'adapters', 'custom.ts'),
        'utf-8',
      );

      // Must import and use randomUUID
      expect(src).toContain("import { randomUUID } from 'crypto'");
      expect(src).toMatch(/randomUUID\(\)/);

      // Must NOT use Date.now() for file naming
      // (Date.now() is fine elsewhere, but the prompt-file path must use randomUUID)
      const promptFileLine = src
        .split('\n')
        .find((l) => l.includes('sweteam-prompt-'));
      expect(promptFileLine).toBeDefined();
      expect(promptFileLine).toContain('randomUUID()');
      expect(promptFileLine).not.toContain('Date.now()');
    });
  });

  // ─── 5. Stdout accumulation cap ────────────────────────────────────
  describe('stdout accumulation cap', () => {
    it('claude-code adapter defines MAX_OUTPUT_SIZE and truncation logic', () => {
      const src = readFileSync(
        join(__dirname, '..', 'adapters', 'claude-code.ts'),
        'utf-8',
      );

      expect(src).toMatch(/MAX_OUTPUT_SIZE\s*=\s*\d+/);
      // Verify truncation: slicing when accumulated text exceeds MAX_OUTPUT_SIZE
      expect(src).toContain('.slice(');
      expect(src).toContain('MAX_OUTPUT_SIZE');
    });

    it('custom adapter defines MAX_OUTPUT_SIZE and truncation logic', () => {
      const src = readFileSync(
        join(__dirname, '..', 'adapters', 'custom.ts'),
        'utf-8',
      );

      expect(src).toMatch(/MAX_OUTPUT_SIZE\s*=\s*\d+/);
      expect(src).toContain('.slice(');
      expect(src).toContain('MAX_OUTPUT_SIZE');
    });
  });
});
