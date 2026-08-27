import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { contextLimitMessage, delimitedToMarkdown, parseDelimited, readSourceFile } from '../../src/core/files.js';

describe('files core', () => {
  describe('contextLimitMessage', () => {
    it('returns friendly message for token count error', () => {
      const err = new Error('Error: 400 The model token count exceeds the limit');
      expect(contextLimitMessage(err)).toContain('File too large');
    });

    it('returns friendly message for context length error', () => {
      const err = 'context length exceeded';
      expect(contextLimitMessage(err)).toContain('File too large');
    });

    it('returns null for unrelated errors', () => {
      const err = new Error('Network error');
      expect(contextLimitMessage(err)).toBeNull();
    });
  });

  describe('parseDelimited', () => {
    it('splits rows on CRLF and LF', () => {
      expect(parseDelimited('a,b\r\nc,d\n,e', ',')).toEqual([['a', 'b'], ['c', 'd'], ['', 'e']]);
    });

    it('honors quoted fields containing delimiters and escaped quotes', () => {
      expect(parseDelimited('name,"quote: ""hi"", ok",z', ',')).toEqual([
        ['name', 'quote: "hi", ok', 'z'],
      ]);
    });

    it('keeps newlines inside quoted fields', () => {
      expect(parseDelimited('"line1\nline2",b', ',')).toEqual([['line1\nline2', 'b']]);
    });

    it('keeps bare quotes literal when not at field start', () => {
      expect(parseDelimited(`it's "fine",b`, ',')).toEqual([[`it's "fine"`, 'b']]);
    });
  });

  describe('delimitedToMarkdown', () => {
    it('renders a header row, separator and body rows', () => {
      expect(delimitedToMarkdown('lang,year\nTS,2012\nRust,2010', ',')).toBe(
        [
          '| lang | year |',
          '| --- | --- |',
          '| TS | 2012 |',
          '| Rust | 2010 |',
        ].join('\n'),
      );
    });

    it('uses tab delimiter for tsv content', () => {
      expect(delimitedToMarkdown('a\tb\n1\t2', '\t')).toBe(
        ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      );
    });

    it('pads ragged rows to the widest row and escapes pipes', () => {
      expect(delimitedToMarkdown('h1,h2\nsolo\nx,a|b', ',')).toBe(
        [
          '| h1 | h2 |',
          '| --- | --- |',
          '| solo |  |',
          '| x | a\\|b |',
        ].join('\n'),
      );
    });

    it('returns empty string for empty input', () => {
      expect(delimitedToMarkdown('', ',')).toBe('');
    });
  });

  describe('readSourceFile with delimited files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-csv-'));

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('converts a CSV file into a Markdown table', async () => {
      const p = path.join(tmpDir, 'people.csv');
      fs.writeFileSync(p, 'name,age\nAda,36\n');
      const src = await readSourceFile(p);
      expect(src.isBase64).toBe(false);
      expect(src.extension).toBe('csv');
      expect(src.content).toContain('| name | age |');
      expect(src.content).toContain('| Ada | 36 |');
    });

    it('converts a TSV file using tab delimiters', async () => {
      const p = path.join(tmpDir, 'data.tsv');
      fs.writeFileSync(p, 'key\tvalue\nalpha\tone\n');
      const src = await readSourceFile(p);
      expect(src.extension).toBe('tsv');
      expect(src.content).toContain('| key | value |');
    });
  });
});
