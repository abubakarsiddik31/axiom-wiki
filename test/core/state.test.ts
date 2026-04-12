import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadState,
  saveState,
  computeHash,
  detectChanges,
  recordIngest,
  migrateFromLog,
  statePath,
  type CompilationState,
} from '../../src/core/state.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-state-test-'));
}

function scaffoldWiki(wikiDir: string): void {
  fs.mkdirSync(path.join(wikiDir, '.axiom'), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/entities'), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/concepts'), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/sources'), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, 'wiki/pages/analyses'), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'wiki/log.md'), '# Wiki Log\n');
}

describe('state management', () => {
  let wikiDir: string;

  beforeEach(() => {
    wikiDir = makeTmpDir();
    scaffoldWiki(wikiDir);
  });

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true });
  });

  // ── statePath ──────────────────────────────────────────────────────────

  describe('statePath', () => {
    it('returns state.json inside wikiDir', () => {
      expect(statePath(wikiDir)).toBe(path.join(wikiDir, 'state.json'));
    });
  });

  // ── loadState ──────────────────────────────────────────────────────────

  describe('loadState', () => {
    it('returns empty state when state.json does not exist', () => {
      const state = loadState(wikiDir);
      expect(state.version).toBe(1);
      expect(state.sources).toEqual({});
      expect(state.frozenSlugs).toEqual([]);
    });

    it('loads existing state from disk', () => {
      const existing: CompilationState = {
        version: 1,
        sources: {
          'test.md': {
            sha256: 'abc123',
            lastIngestedAt: '2024-01-01',
            sizeBytes: 100,
            concepts: ['wiki/pages/concepts/test.md'],
            truncated: false,
          },
        },
        frozenSlugs: [],
      };
      fs.writeFileSync(statePath(wikiDir), JSON.stringify(existing, null, 2));

      const state = loadState(wikiDir);
      expect(state.sources['test.md']?.sha256).toBe('abc123');
      expect(state.sources['test.md']?.concepts).toEqual(['wiki/pages/concepts/test.md']);
    });

    it('recovers from corrupted state.json with backup', () => {
      const fp = statePath(wikiDir);
      fs.writeFileSync(fp, 'not valid json!!!');

      const state = loadState(wikiDir);
      expect(state.version).toBe(1);
      expect(state.sources).toEqual({});

      // Backup should be created
      expect(fs.existsSync(fp + '.bak')).toBe(true);
    });

    it('handles state without frozenSlugs field (old format)', () => {
      const old = { version: 1, sources: {} };
      fs.writeFileSync(statePath(wikiDir), JSON.stringify(old));

      const state = loadState(wikiDir);
      expect(state.frozenSlugs).toEqual([]);
    });

    it('returns empty state for unsupported version', () => {
      const future = { version: 99, sources: {}, frozenSlugs: [] };
      fs.writeFileSync(statePath(wikiDir), JSON.stringify(future));

      const state = loadState(wikiDir);
      expect(state.sources).toEqual({});
    });
  });

  // ── saveState ──────────────────────────────────────────────────────────

  describe('saveState', () => {
    it('writes state to disk atomically', () => {
      const state: CompilationState = {
        version: 1,
        sources: { 'file.md': { sha256: 'hash1', lastIngestedAt: '2024-01-01', sizeBytes: 50, concepts: [], truncated: false } },
        frozenSlugs: [],
      };
      saveState(wikiDir, state);

      const fp = statePath(wikiDir);
      expect(fs.existsSync(fp)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      expect(loaded.sources['file.md'].sha256).toBe('hash1');
    });

    it('creates .axiom directory if missing', () => {
      const freshDir = makeTmpDir();
      const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
      saveState(freshDir, state);

      expect(fs.existsSync(statePath(freshDir))).toBe(true);
      fs.rmSync(freshDir, { recursive: true, force: true });
    });

    it('does not leave .tmp file after write', () => {
      const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
      saveState(wikiDir, state);

      expect(fs.existsSync(statePath(wikiDir) + '.tmp')).toBe(false);
    });
  });

  // ── computeHash ────────────────────────────────────────────────────────

  describe('computeHash', () => {
    it('returns consistent SHA-256 hex digest', () => {
      const filepath = path.join(wikiDir, 'raw/test.md');
      fs.writeFileSync(filepath, 'hello world');

      const hash1 = computeHash(filepath);
      const hash2 = computeHash(filepath);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns different hash for different content', () => {
      const file1 = path.join(wikiDir, 'raw/a.md');
      const file2 = path.join(wikiDir, 'raw/b.md');
      fs.writeFileSync(file1, 'content A');
      fs.writeFileSync(file2, 'content B');

      expect(computeHash(file1)).not.toBe(computeHash(file2));
    });

    it('detects content changes', () => {
      const filepath = path.join(wikiDir, 'raw/test.md');
      fs.writeFileSync(filepath, 'original content');
      const hash1 = computeHash(filepath);

      fs.writeFileSync(filepath, 'modified content');
      const hash2 = computeHash(filepath);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ── detectChanges ──────────────────────────────────────────────────────

  describe('detectChanges', () => {
    it('classifies new files correctly', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(rawDir, 'new.md'), 'new file');

      const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
      const changes = detectChanges(rawDir, ['new.md'], state);

      expect(changes).toHaveLength(1);
      expect(changes[0]?.kind).toBe('new');
      expect(changes[0]?.filename).toBe('new.md');
    });

    it('classifies unchanged files correctly', () => {
      const rawDir = path.join(wikiDir, 'raw');
      const filepath = path.join(rawDir, 'same.md');
      fs.writeFileSync(filepath, 'same content');
      const hash = computeHash(filepath);

      const state: CompilationState = {
        version: 1,
        sources: { 'same.md': { sha256: hash, lastIngestedAt: '2024-01-01', sizeBytes: 12, concepts: [], truncated: false } },
        frozenSlugs: [],
      };
      const changes = detectChanges(rawDir, ['same.md'], state);

      expect(changes).toHaveLength(1);
      expect(changes[0]?.kind).toBe('unchanged');
    });

    it('classifies changed files correctly', () => {
      const rawDir = path.join(wikiDir, 'raw');
      const filepath = path.join(rawDir, 'mod.md');
      fs.writeFileSync(filepath, 'modified content');

      const state: CompilationState = {
        version: 1,
        sources: { 'mod.md': { sha256: 'old-hash', lastIngestedAt: '2024-01-01', sizeBytes: 10, concepts: [], truncated: false } },
        frozenSlugs: [],
      };
      const changes = detectChanges(rawDir, ['mod.md'], state);

      expect(changes).toHaveLength(1);
      expect(changes[0]?.kind).toBe('changed');
    });

    it('handles mixed files correctly', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(rawDir, 'new.md'), 'new');
      fs.writeFileSync(path.join(rawDir, 'same.md'), 'same');
      fs.writeFileSync(path.join(rawDir, 'changed.md'), 'changed');

      const sameHash = computeHash(path.join(rawDir, 'same.md'));
      const state: CompilationState = {
        version: 1,
        sources: {
          'same.md': { sha256: sameHash, lastIngestedAt: '2024-01-01', sizeBytes: 4, concepts: [], truncated: false },
          'changed.md': { sha256: 'stale-hash', lastIngestedAt: '2024-01-01', sizeBytes: 5, concepts: [], truncated: false },
        },
        frozenSlugs: [],
      };
      const changes = detectChanges(rawDir, ['new.md', 'same.md', 'changed.md'], state);

      expect(changes).toHaveLength(3);
      expect(changes.find((c) => c.filename === 'new.md')?.kind).toBe('new');
      expect(changes.find((c) => c.filename === 'same.md')?.kind).toBe('unchanged');
      expect(changes.find((c) => c.filename === 'changed.md')?.kind).toBe('changed');
    });
  });

  // ── recordIngest ───────────────────────────────────────────────────────

  describe('recordIngest', () => {
    it('adds new source entry to state', () => {
      const rawDir = path.join(wikiDir, 'raw');
      const filepath = path.join(rawDir, 'doc.md');
      fs.writeFileSync(filepath, 'document content');

      const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
      recordIngest(state, 'doc.md', filepath, ['wiki/pages/concepts/test.md']);

      expect(state.sources['doc.md']).toBeDefined();
      expect(state.sources['doc.md']?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(state.sources['doc.md']?.concepts).toEqual(['wiki/pages/concepts/test.md']);
      expect(state.sources['doc.md']?.truncated).toBe(false);
      expect(state.sources['doc.md']?.lastIngestedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('updates existing source entry', () => {
      const rawDir = path.join(wikiDir, 'raw');
      const filepath = path.join(rawDir, 'doc.md');
      fs.writeFileSync(filepath, 'original');

      const state: CompilationState = {
        version: 1,
        sources: { 'doc.md': { sha256: 'old', lastIngestedAt: '2023-01-01', sizeBytes: 5, concepts: ['old-page'], truncated: false } },
        frozenSlugs: [],
      };
      recordIngest(state, 'doc.md', filepath, ['new-page']);

      expect(state.sources['doc.md']?.sha256).not.toBe('old');
      expect(state.sources['doc.md']?.concepts).toEqual(['new-page']);
    });

    it('records truncated flag', () => {
      const rawDir = path.join(wikiDir, 'raw');
      const filepath = path.join(rawDir, 'big.md');
      fs.writeFileSync(filepath, 'big file');

      const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
      recordIngest(state, 'big.md', filepath, [], true);

      expect(state.sources['big.md']?.truncated).toBe(true);
    });
  });

  // ── migrateFromLog ─────────────────────────────────────────────────────

  describe('migrateFromLog', () => {
    it('bootstraps state from existing log.md', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(rawDir, 'doc1.md'), 'content of doc1');
      fs.writeFileSync(path.join(rawDir, 'doc2.txt'), 'content of doc2');

      // Write log entries
      const logPath = path.join(wikiDir, 'wiki/log.md');
      fs.writeFileSync(logPath, [
        '# Wiki Log',
        '## [2024-04-10] ingest | doc1.md (3 pages)',
        '## [2024-04-11] ingest | doc2.txt (1 pages)',
      ].join('\n'));

      const state = migrateFromLog(wikiDir, rawDir);

      expect(state.sources['doc1.md']).toBeDefined();
      expect(state.sources['doc1.md']?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(state.sources['doc2.txt']).toBeDefined();
      expect(state.sources['doc2.txt']?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('skips files not present on disk', () => {
      const rawDir = path.join(wikiDir, 'raw');
      // doc1.md is in log but NOT on disk
      const logPath = path.join(wikiDir, 'wiki/log.md');
      fs.writeFileSync(logPath, '## [2024-04-10] ingest | deleted.md (2 pages)\n');

      const state = migrateFromLog(wikiDir, rawDir);

      expect(state.sources['deleted.md']).toBeUndefined();
    });

    it('maps concepts from page frontmatter sources field', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(rawDir, 'paper.md'), 'paper content');

      const logPath = path.join(wikiDir, 'wiki/log.md');
      fs.writeFileSync(logPath, '## [2024-04-10] ingest | paper.md (2 pages)\n');

      // Create a wiki page that references this source
      const pagePath = path.join(wikiDir, 'wiki/pages/concepts/machine-learning.md');
      fs.writeFileSync(pagePath, [
        '---',
        'title: Machine Learning',
        'summary: Overview of ML',
        'tags: [ai]',
        'category: concepts',
        'sources: [paper.md]',
        'updatedAt: 2024-04-10',
        '---',
        '',
        'Content here.',
      ].join('\n'));

      const state = migrateFromLog(wikiDir, rawDir);

      expect(state.sources['paper.md']?.concepts).toContain('wiki/pages/concepts/machine-learning.md');
    });

    it('persists migrated state to disk', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(rawDir, 'test.md'), 'test');
      fs.writeFileSync(path.join(wikiDir, 'wiki/log.md'), '## [2024-04-10] ingest | test.md\n');

      migrateFromLog(wikiDir, rawDir);

      expect(fs.existsSync(statePath(wikiDir))).toBe(true);
      const saved = JSON.parse(fs.readFileSync(statePath(wikiDir), 'utf-8'));
      expect(saved.sources['test.md']).toBeDefined();
    });

    it('returns empty state when log has no ingest entries', () => {
      const rawDir = path.join(wikiDir, 'raw');
      fs.writeFileSync(path.join(wikiDir, 'wiki/log.md'), '# Wiki Log\n## [2024-04-10] query | test\n');

      const state = migrateFromLog(wikiDir, rawDir);
      expect(Object.keys(state.sources)).toHaveLength(0);
    });
  });
});
