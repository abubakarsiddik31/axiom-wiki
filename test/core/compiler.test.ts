import { describe, it, expect } from 'vitest';
import {
  buildConceptSourceMap,
  findAffectedConcepts,
  buildRecompilationPlan,
} from '../../src/core/compiler.js';
import type { CompilationState, FileChange } from '../../src/core/state.js';

function makeState(sources: Record<string, string[]>): CompilationState {
  const state: CompilationState = { version: 1, sources: {}, frozenSlugs: [] };
  for (const [filename, concepts] of Object.entries(sources)) {
    state.sources[filename] = {
      sha256: `hash-${filename}`,
      lastIngestedAt: '2024-01-01',
      sizeBytes: 1000,
      concepts,
      truncated: false,
    };
  }
  return state;
}

describe('compiler', () => {
  describe('buildConceptSourceMap', () => {
    it('builds reverse index from state', () => {
      const state = makeState({
        'a.pdf': ['wiki/pages/concepts/ml.md', 'wiki/pages/entities/turing.md'],
        'b.pdf': ['wiki/pages/concepts/ml.md', 'wiki/pages/concepts/ai.md'],
        'c.pdf': ['wiki/pages/concepts/ai.md'],
      });

      const map = buildConceptSourceMap(state);

      expect(map.get('wiki/pages/concepts/ml.md')).toEqual(['a.pdf', 'b.pdf']);
      expect(map.get('wiki/pages/concepts/ai.md')).toEqual(['b.pdf', 'c.pdf']);
      expect(map.get('wiki/pages/entities/turing.md')).toEqual(['a.pdf']);
    });

    it('returns empty map for empty state', () => {
      const state = makeState({});
      const map = buildConceptSourceMap(state);
      expect(map.size).toBe(0);
    });
  });

  describe('findAffectedConcepts', () => {
    it('identifies concepts shared between changed and unchanged sources', () => {
      const map = new Map<string, string[]>([
        ['wiki/pages/concepts/ml.md', ['a.pdf', 'b.pdf']],
        ['wiki/pages/concepts/ai.md', ['b.pdf', 'c.pdf']],
        ['wiki/pages/entities/turing.md', ['a.pdf']],
      ]);

      const result = findAffectedConcepts(map, ['a.pdf']);

      expect(result.concepts).toEqual(['wiki/pages/concepts/ml.md']);
      expect(result.additionalSources).toEqual(['b.pdf']);
    });

    it('ignores concepts only from changed sources', () => {
      const map = new Map<string, string[]>([
        ['wiki/pages/entities/turing.md', ['a.pdf']],
      ]);

      const result = findAffectedConcepts(map, ['a.pdf']);

      expect(result.concepts).toEqual([]);
      expect(result.additionalSources).toEqual([]);
    });

    it('returns empty when all sources changed', () => {
      const map = new Map<string, string[]>([
        ['wiki/pages/concepts/ml.md', ['a.pdf', 'b.pdf']],
      ]);

      const result = findAffectedConcepts(map, ['a.pdf', 'b.pdf']);

      expect(result.concepts).toEqual([]);
      expect(result.additionalSources).toEqual([]);
    });

    it('deduplicates additional sources across multiple concepts', () => {
      const map = new Map<string, string[]>([
        ['wiki/pages/concepts/ml.md', ['a.pdf', 'b.pdf']],
        ['wiki/pages/concepts/ai.md', ['a.pdf', 'b.pdf']],
      ]);

      const result = findAffectedConcepts(map, ['a.pdf']);

      expect(result.concepts).toEqual([
        'wiki/pages/concepts/ai.md',
        'wiki/pages/concepts/ml.md',
      ]);
      expect(result.additionalSources).toEqual(['b.pdf']);
    });
  });

  describe('buildRecompilationPlan', () => {
    it('builds plan with shared concepts and additional sources', () => {
      const state = makeState({
        'a.pdf': ['wiki/pages/concepts/ml.md', 'wiki/pages/entities/turing.md'],
        'b.pdf': ['wiki/pages/concepts/ml.md'],
        'c.pdf': ['wiki/pages/concepts/ai.md'],
      });

      const changes: FileChange[] = [
        { filename: 'a.pdf', filepath: '/raw/a.pdf', kind: 'changed' },
        { filename: 'b.pdf', filepath: '/raw/b.pdf', kind: 'unchanged' },
        { filename: 'c.pdf', filepath: '/raw/c.pdf', kind: 'unchanged' },
      ];

      const plan = buildRecompilationPlan(state, changes);

      expect(plan.directSources).toHaveLength(1);
      expect(plan.directSources[0].filename).toBe('a.pdf');
      expect(plan.affectedConcepts).toEqual(['wiki/pages/concepts/ml.md']);
      expect(plan.additionalSources).toEqual(['b.pdf']);
      expect(plan.summary).toContain('1 source changed');
      expect(plan.summary).toContain('1 shared concept');
      expect(plan.summary).toContain('1 additional source');
    });

    it('returns empty plan for no changes', () => {
      const state = makeState({ 'a.pdf': ['wiki/pages/concepts/ml.md'] });
      const changes: FileChange[] = [
        { filename: 'a.pdf', filepath: '/raw/a.pdf', kind: 'unchanged' },
      ];

      const plan = buildRecompilationPlan(state, changes);

      expect(plan.directSources).toHaveLength(0);
      expect(plan.affectedConcepts).toEqual([]);
      expect(plan.additionalSources).toEqual([]);
    });

    it('handles new sources with no shared concepts', () => {
      const state = makeState({});
      const changes: FileChange[] = [
        { filename: 'new.pdf', filepath: '/raw/new.pdf', kind: 'new' },
      ];

      const plan = buildRecompilationPlan(state, changes);

      expect(plan.directSources).toHaveLength(1);
      expect(plan.affectedConcepts).toEqual([]);
      expect(plan.additionalSources).toEqual([]);
      expect(plan.summary).toBe('1 source changed');
    });

    it('handles all sources changed — no additional sources needed', () => {
      const state = makeState({
        'a.pdf': ['wiki/pages/concepts/ml.md'],
        'b.pdf': ['wiki/pages/concepts/ml.md'],
      });
      const changes: FileChange[] = [
        { filename: 'a.pdf', filepath: '/raw/a.pdf', kind: 'changed' },
        { filename: 'b.pdf', filepath: '/raw/b.pdf', kind: 'changed' },
      ];

      const plan = buildRecompilationPlan(state, changes);

      expect(plan.directSources).toHaveLength(2);
      expect(plan.affectedConcepts).toEqual([]);
      expect(plan.additionalSources).toEqual([]);
    });
  });
});
