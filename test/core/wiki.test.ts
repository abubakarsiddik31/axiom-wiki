import { describe, it, expect } from 'vitest';
import { capitalize, today, buildIndex, PageMeta } from '../../src/core/wiki.js';

describe('wiki helpers', () => {
  describe('capitalize', () => {
    it('capitalizes first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });

    it('handles empty string', () => {
      expect(capitalize('')).toBe('');
    });
  });

  describe('today', () => {
    it('returns date in YYYY-MM-DD format', () => {
      expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('buildIndex', () => {
    it('generates index markdown correctly', () => {
      const pages: PageMeta[] = [
        {
          path: 'wiki/pages/entities/test.md',
          title: 'Test Entity',
          summary: 'A test summary',
          tags: ['tag1'],
          category: 'entities',
          updatedAt: '2023-01-01'
        }
      ];
      const index = buildIndex(pages);
      expect(index).toContain('# Wiki Index');
      expect(index).toContain('## Entities');
      expect(index).toContain('- [[pages/entities/test]] — Test Entity · A test summary · tag1');
    });

    it('handles empty pages list', () => {
      const index = buildIndex([]);
      expect(index).toContain('# Wiki Index');
      expect(index).toContain('## Entities');
      expect(index).toContain('## Concepts');
      expect(index).toContain('## Sources');
      expect(index).toContain('## Analyses');
    });
  });
});
