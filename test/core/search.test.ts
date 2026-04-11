import { describe, it, expect } from 'vitest';
import { countOccurrences, buildExcerpt } from '../../src/core/search.js';

describe('search helpers', () => {
  describe('countOccurrences', () => {
    it('counts single occurrences correctly', () => {
      expect(countOccurrences('hello world', 'hello')).toBe(1);
    });

    it('counts multiple occurrences correctly', () => {
      expect(countOccurrences('hello hello hello', 'hello')).toBe(3);
    });

    it('returns 0 when term is not found', () => {
      expect(countOccurrences('hello world', 'missing')).toBe(0);
    });

    it('is case sensitive (based on implementation)', () => {
      // The implementation uses text.indexOf(term), so it is case sensitive
      expect(countOccurrences('Hello world', 'hello')).toBe(0);
    });
  });

  describe('buildExcerpt', () => {
    it('highlights matched terms', () => {
      const content = 'This is a test content with some keywords.';
      const terms = ['test', 'keywords'];
      const excerpt = buildExcerpt(content, terms);
      expect(excerpt).toContain('*test*');
      expect(excerpt).toContain('*keywords*');
    });

    it('handles multiple occurrences of same term', () => {
      const content = 'test test test';
      const terms = ['test'];
      const excerpt = buildExcerpt(content, terms);
      expect(excerpt).toBe('*test* *test* *test*');
    });

    it('finds best window (basic test)', () => {
      const content = 'ignore this part. ' + 'match match match '.repeat(10) + ' ignore this too.';
      const terms = ['match'];
      const excerpt = buildExcerpt(content, terms);
      expect(countOccurrences(excerpt.toLowerCase(), 'match')).toBeGreaterThan(1);
    });
  });
});
