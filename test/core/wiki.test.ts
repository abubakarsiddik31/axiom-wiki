import { describe, it, expect } from 'vitest';
import { capitalize, today, buildIndex, buildMOC, PageMeta } from '../../src/core/wiki.js';

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

  describe('buildMOC', () => {
    it('groups pages by tags', () => {
      const pages: PageMeta[] = [
        {
          path: 'wiki/pages/concepts/ml.md',
          title: 'Machine Learning',
          summary: '',
          tags: ['ai', 'math'],
          category: 'concepts',
          updatedAt: '2024-01-01',
        },
        {
          path: 'wiki/pages/entities/turing.md',
          title: 'Alan Turing',
          summary: '',
          tags: ['ai', 'history'],
          category: 'entities',
          updatedAt: '2024-01-01',
        },
      ];

      const moc = buildMOC(pages);

      expect(moc).toContain('# Map of Content');
      expect(moc).toContain('## ai');
      expect(moc).toContain('## history');
      expect(moc).toContain('## math');
      expect(moc).toContain('- [[pages/concepts/ml]] — Machine Learning');
      expect(moc).toContain('- [[pages/entities/turing]] — Alan Turing');
    });

    it('sorts tags alphabetically', () => {
      const pages: PageMeta[] = [
        {
          path: 'wiki/pages/concepts/z.md',
          title: 'Z Topic',
          summary: '',
          tags: ['zebra', 'alpha'],
          category: 'concepts',
          updatedAt: '2024-01-01',
        },
      ];

      const moc = buildMOC(pages);
      const alphaIdx = moc.indexOf('## alpha');
      const zebraIdx = moc.indexOf('## zebra');
      expect(alphaIdx).toBeLessThan(zebraIdx);
    });

    it('omits pages with no tags', () => {
      const pages: PageMeta[] = [
        {
          path: 'wiki/pages/concepts/no-tags.md',
          title: 'No Tags',
          summary: '',
          tags: [],
          category: 'concepts',
          updatedAt: '2024-01-01',
        },
      ];

      const moc = buildMOC(pages);
      expect(moc).not.toContain('No Tags');
      expect(moc).toContain('No tagged pages yet.');
    });

    it('handles empty pages list', () => {
      const moc = buildMOC([]);
      expect(moc).toContain('# Map of Content');
      expect(moc).toContain('No tagged pages yet.');
    });

    it('uses correct link format', () => {
      const pages: PageMeta[] = [
        {
          path: 'wiki/pages/entities/alan-turing.md',
          title: 'Alan Turing',
          summary: '',
          tags: ['cs'],
          category: 'entities',
          updatedAt: '2024-01-01',
        },
      ];

      const moc = buildMOC(pages);
      expect(moc).toContain('- [[pages/entities/alan-turing]] — Alan Turing');
    });
  });
});
