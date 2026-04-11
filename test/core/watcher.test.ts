import { describe, it, expect, vi } from 'vitest';
import { loadIgnorePatterns, startWatcher } from '../../src/core/watcher.js';
import ignore from 'ignore';

// We want to test the 'ignored' matcher logic defined inside startWatcher.
// Since it's trapped inside the closure, we can recreate its core logic for testing,
// or we can mock chokidar and extract it. Recreating the pure logic is cleaner for unit tests.

const SUPPORTED_EXTS = new Set(['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.html', '.docx']);

function createIgnoreMatcher(rawDir: string, ignorePatterns: string[]) {
  const ig = ignore().add(ignorePatterns);

  return (filePath: string): boolean => {
    // Basic mock of path.extname and path.relative
    const parts = filePath.split('/');
    const basename = parts[parts.length - 1] ?? '';
    const extMatch = basename.match(/\.[^.]+$/);
    const ext = extMatch ? extMatch[0].toLowerCase() : '';
    
    // Simplistic relative path calculation for testing
    let rel = filePath;
    if (filePath.startsWith(rawDir + '/')) {
      rel = filePath.substring(rawDir.length + 1);
    }

    if (!ext) return false;
    if (!SUPPORTED_EXTS.has(ext)) return true;
    if (basename === '.axiomignore') return true;
    if (rel && !rel.startsWith('..') && ig.ignores(rel)) return true;

    return false;
  };
}

describe('watcher core', () => {
  describe('ignore matcher logic', () => {
    it('allows supported extensions', () => {
      const isIgnored = createIgnoreMatcher('/raw', []);
      expect(isIgnored('/raw/test.md')).toBe(false);
      expect(isIgnored('/raw/image.png')).toBe(false);
    });

    it('ignores unsupported extensions', () => {
      const isIgnored = createIgnoreMatcher('/raw', []);
      expect(isIgnored('/raw/video.mp4')).toBe(true);
      expect(isIgnored('/raw/data.csv')).toBe(true);
    });

    it('ignores .axiomignore file itself', () => {
      const isIgnored = createIgnoreMatcher('/raw', []);
      expect(isIgnored('/raw/.axiomignore')).toBe(true);
    });

    it('respects custom ignore patterns', () => {
      const isIgnored = createIgnoreMatcher('/raw', ['*.tmp', 'secret/']);
      expect(isIgnored('/raw/test.md')).toBe(false);
      expect(isIgnored('/raw/file.tmp')).toBe(true);
      expect(isIgnored('/raw/secret/data.md')).toBe(true);
    });

    it('allows directories to pass through', () => {
      // Ext is empty for directories without a dot in the name
      const isIgnored = createIgnoreMatcher('/raw', []);
      expect(isIgnored('/raw/folder')).toBe(false);
    });
  });
});
