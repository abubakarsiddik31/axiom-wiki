import { describe, it, expect } from 'vitest';
import { extractLinks } from '../../src/core/graph.js';

describe('graph core', () => {
  describe('extractLinks', () => {
    it('extracts simple wiki-links', () => {
      const content = 'Check out [[entities/alan-turing]] and [[concepts/turing-completeness]].';
      const links = extractLinks(content);
      expect(links).toContain('entities/alan-turing');
      expect(links).toContain('concepts/turing-completeness');
    });

    it('defaults to entities/ category if missing', () => {
      const content = 'Check out [[alan-turing]].';
      const links = extractLinks(content);
      expect(links).toContain('entities/alan-turing');
    });

    it('normalizes slashes', () => {
      const content = 'Check out [[entities\\alan-turing]].';
      const links = extractLinks(content);
      expect(links).toContain('entities/alan-turing');
    });

    it('ignores duplicates', () => {
      const content = '[[link1]] [[link1]] [[link1]]';
      const links = extractLinks(content);
      expect(links).toHaveLength(1);
    });

    it('handles whitespace', () => {
      const content = '[[  entities/alan-turing  ]]';
      const links = extractLinks(content);
      expect(links).toContain('entities/alan-turing');
    });
  });
});
