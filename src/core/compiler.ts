import type { CompilationState, FileChange } from './state.js'

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface RecompilationPlan {
  /** Sources that are new or have changed hashes */
  directSources: FileChange[]
  /** Concept page paths shared between changed and unchanged sources */
  affectedConcepts: string[]
  /** Unchanged source filenames pulled in because they share concepts */
  additionalSources: string[]
  /** Human-readable summary for UI */
  summary: string
}

// ── Functions ───────────────────────────────────────────────────────────────

/**
 * Build a reverse index: concept page path → source filenames that produced it.
 */
export function buildConceptSourceMap(
  state: CompilationState,
): Map<string, string[]> {
  const map = new Map<string, string[]>()

  for (const [filename, sourceState] of Object.entries(state.sources)) {
    for (const concept of sourceState.concepts) {
      const list = map.get(concept) ?? []
      list.push(filename)
      map.set(concept, list)
    }
  }

  return map
}

/**
 * Find concepts shared between changed and unchanged sources.
 * Returns the affected concept paths and the unchanged source filenames
 * that need to be pulled in for recompilation.
 */
export function findAffectedConcepts(
  conceptMap: Map<string, string[]>,
  changedSources: string[],
): { concepts: string[]; additionalSources: string[] } {
  const changedSet = new Set(changedSources)
  const affectedConcepts: string[] = []
  const additionalSourceSet = new Set<string>()

  for (const [concept, sources] of conceptMap) {
    const hasChanged = sources.some((s) => changedSet.has(s))
    const unchangedContributors = sources.filter((s) => !changedSet.has(s))

    if (hasChanged && unchangedContributors.length > 0) {
      affectedConcepts.push(concept)
      for (const s of unchangedContributors) {
        additionalSourceSet.add(s)
      }
    }
  }

  return {
    concepts: affectedConcepts.sort(),
    additionalSources: [...additionalSourceSet].sort(),
  }
}

/**
 * Build a full recompilation plan from state and detected file changes.
 */
export function buildRecompilationPlan(
  state: CompilationState,
  changes: FileChange[],
): RecompilationPlan {
  const directSources = changes.filter((c) => c.kind !== 'unchanged')
  const changedFilenames = directSources.map((c) => c.filename)

  const conceptMap = buildConceptSourceMap(state)
  const { concepts, additionalSources } = findAffectedConcepts(
    conceptMap,
    changedFilenames,
  )

  const parts: string[] = []
  parts.push(`${directSources.length} source${directSources.length === 1 ? '' : 's'} changed`)
  if (concepts.length > 0) {
    parts.push(`${concepts.length} shared concept${concepts.length === 1 ? '' : 's'} need recompilation`)
  }
  if (additionalSources.length > 0) {
    parts.push(`pulling in ${additionalSources.length} additional source${additionalSources.length === 1 ? '' : 's'}`)
  }

  return {
    directSources,
    affectedConcepts: concepts,
    additionalSources,
    summary: parts.join(', '),
  }
}
