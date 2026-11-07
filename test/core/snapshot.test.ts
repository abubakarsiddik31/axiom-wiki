import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { buildWikiSnapshot } from '../../src/core/snapshot.js'
import { listPages } from '../../src/core/wiki.js'
import { buildGraph, getBacklinks, backlinksFromGraph } from '../../src/core/graph.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-snapshot-'))
const wikiDir = path.join(root, 'wiki', 'pages')
fs.mkdirSync(path.join(wikiDir, 'entities'), { recursive: true })
fs.mkdirSync(path.join(wikiDir, 'concepts'), { recursive: true })

function write(rel: string, body: string): void {
  const abs = path.join(wikiDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
}

write(
  'entities/alan.md',
  `---
title: "Alan"
summary: "Mathematician"
tags: [computing]
category: entities
updatedAt: "2026-01-02"
---

See [[concepts/machine]] twice: [[concepts/machine]]. Also [[concepts/missing]].
`,
)
write(
  'concepts/machine.md',
  `---
title: "Machine"
summary: "Abstract model"
tags: [theory]
category: concepts
---

Back to [[entities/alan]].
`,
)
write(
  'concepts/orphan.md',
  `---
title: "Orphan"
category: concepts
---

Nobody links here.
`,
)
write('concepts/no-frontmatter.md', '# Heading\n\nNo frontmatter at all.\n')

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('wiki snapshot', () => {
  it('returns the same pages as listPages', async () => {
    const snapshot = buildWikiSnapshot(root)
    const pages = await listPages(root)
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
    expect([...snapshot.pages].sort(byPath)).toEqual([...pages].sort(byPath))
  })

  it('returns the same graph as buildGraph', () => {
    const snapshot = buildWikiSnapshot(root)
    const graph = buildGraph(root)
    expect([...snapshot.graph.nodes.keys()].sort()).toEqual([...graph.nodes.keys()].sort())
    expect(snapshot.graph.edges).toEqual(graph.edges)
    expect([...snapshot.graph.orphans].sort()).toEqual([...graph.orphans].sort())
    expect(snapshot.graph.deadLinks).toEqual(graph.deadLinks)
  })

  it('serves backlinks without rebuilding the graph', () => {
    const snapshot = buildWikiSnapshot(root)
    expect(backlinksFromGraph(snapshot.graph, 'concepts/machine')).toEqual(
      getBacklinks(root, 'concepts/machine'),
    )
    expect(backlinksFromGraph(snapshot.graph, 'concepts/machine')).toHaveLength(1)
  })

  it('ranks existing pages by degree', () => {
    const snapshot = buildWikiSnapshot(root)
    expect(snapshot.rankedIds).toHaveLength(snapshot.pages.length)
    expect([...snapshot.rankedIds].sort()).toEqual(
      [...snapshot.graph.nodes.values()].filter((n) => n.exists).map((n) => n.id).sort(),
    )
  })

  it('handles an empty wiki', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-empty-'))
    const snapshot = buildWikiSnapshot(empty)
    expect(snapshot.pages).toEqual([])
    expect(snapshot.graph.nodes.size).toBe(0)
    expect(snapshot.rankedIds).toEqual([])
    fs.rmSync(empty, { recursive: true, force: true })
  })
})
