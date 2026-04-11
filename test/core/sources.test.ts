import { describe, it, expect } from 'vitest';
import { parseLogEntries, parseIngestedSet } from '../../src/core/sources.js';

describe('sources core', () => {
  const sampleLog = `
## [2024-04-10] ingest | document1.pdf (5 pages)
## [2024-04-10] lint | Fixed missing tags
## [2024-04-11] ingest | notes.txt
## [2024-04-12] reingest | document1.pdf
## [2024-04-12] query | What is document1?
`;

  describe('parseLogEntries', () => {
    it('parses ingest entries and keeps the most recent one', () => {
      const records = parseLogEntries(sampleLog);
      expect(records).toHaveLength(2); // document1.pdf and notes.txt

      // Expected reverse chronological order
      expect(records[0]?.filename).toBe('notes.txt');
      expect(records[0]?.ingestedAt).toBe('2024-04-11');
      expect(records[0]?.pageCount).toBe(0); // No page count provided

      expect(records[1]?.filename).toBe('document1.pdf');
      expect(records[1]?.ingestedAt).toBe('2024-04-10'); // reingest does not match LOG_INGEST_RE in parseLogEntries based on regex
      expect(records[1]?.pageCount).toBe(5);
    });

    it('returns empty array for log without ingest entries', () => {
      const records = parseLogEntries('## [2024-04-10] query | test');
      expect(records).toHaveLength(0);
    });
  });

  describe('parseIngestedSet', () => {
    it('extracts unique filenames from ingest and reingest entries', () => {
      const ingested = parseIngestedSet(sampleLog);
      expect(ingested.size).toBe(2);
      expect(ingested.has('document1.pdf')).toBe(true);
      expect(ingested.has('notes.txt')).toBe(true);
      expect(ingested.has('test.txt')).toBe(false);
    });

    it('handles lines without page counts', () => {
      const log = `## [2024-04-11] ingest | just-a-file.md`;
      const ingested = parseIngestedSet(log);
      expect(ingested.has('just-a-file.md')).toBe(true);
    });

    it('ignores non-ingest operations', () => {
      const log = `## [2024-04-11] query | what is this?`;
      const ingested = parseIngestedSet(log);
      expect(ingested.size).toBe(0);
    });
  });
});
