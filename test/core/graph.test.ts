import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractLinks, getBacklinks } from '../../src/core/graph.js';

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

  describe('getBacklinks', () => {
    const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-backlinks-'));
    const pagesDir = path.join(wikiDir, 'wiki', 'pages');

    const writePage = (id: string, title: string, body: string) => {
      const p = path.join(pagesDir, `${id}.md`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(
        p,
        `---\ntitle: "${title}"\nsummary: ""\ntags: []\ncategory: ${id.split('/')[0]}\nupdatedAt: "2026-08-27"\n---\n\n${body}\n`,
      );
    };

    writePage('entities/a', 'Page A', 'A links to [[concepts/b]] and [[c]].');
    writePage('concepts/b', 'Page B', 'B links back to [[entities/a]].');
    writePage('entities/c', 'Page C', 'C links to [[concepts/b]] too.');

    afterAll(() => {
      fs.rmSync(wikiDir, { recursive: true, force: true });
    });

    it('returns every page that links to the target with its title', () => {
      const backlinks = getBacklinks(wikiDir, 'concepts/b');
      expect(backlinks.map((b) => b.fromId).sort()).toEqual(['entities/a', 'entities/c']);
      expect(backlinks.find((b) => b.fromId === 'entities/a')?.fromTitle).toBe('Page A');
    });

    it('applies the bare-slug entities/ default to link targets', () => {
      expect(getBacklinks(wikiDir, 'entities/c').map((b) => b.fromId)).toEqual(['entities/a']);
    });

    it('returns an empty list for pages with no inbound links', () => {
      expect(getBacklinks(wikiDir, 'nonexistent/page')).toEqual([]);
    });
  });
});
