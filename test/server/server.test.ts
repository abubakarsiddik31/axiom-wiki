import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Server } from 'http'

import {
  rewriteWikiLinks,
  renderMarkdown,
  renderGraphSvg,
  idFromPath,
} from '../../src/server/render.js'
import { parseFrontmatter, startServer } from '../../src/server/index.js'
import { buildGraph } from '../../src/core/graph.js'
import type { AxiomConfig } from '../../src/config/index.js'

describe('link rewriting', () => {
  it('rewrites full wiki-links with category', () => {
    expect(rewriteWikiLinks('See [[entities/alan-turing]] here'))
      .toBe('See [entities/alan-turing](/page/entities/alan-turing) here')
  })

  it('defaults bare wiki-links to entities/', () => {
    expect(rewriteWikiLinks('[[alan-turing]]'))
      .toBe('[alan-turing](/page/entities/alan-turing)')
  })

  it('supports alias syntax [[id|Title]]', () => {
    expect(rewriteWikiLinks('[[entities/alan-turing|Turing]]'))
      .toBe('[Turing](/page/entities/alan-turing)')
  })

  it('rewrites relative .md links', () => {
    expect(rewriteWikiLinks('[bar](../concepts/bar.md)'))
      .toBe('[bar](/page/concepts/bar)')
    expect(rewriteWikiLinks('[bar](concepts/bar.md)'))
      .toBe('[bar](/page/concepts/bar)')
  })

  it('leaves external .md URLs untouched', () => {
    const md = '[doc](https://example.com/readme.md)'
    expect(rewriteWikiLinks(md)).toBe(md)
  })

  it('renders rewritten links as anchors', () => {
    const html = renderMarkdown('Learn from [[entities/alan-turing]]')
    expect(html).toContain('<a href="/page/entities/alan-turing">entities/alan-turing</a>')
  })

  it('adds heading ids that match search section anchors', () => {
    expect(renderMarkdown('## Limits of Computation')).toContain('id="limits-of-computation"')
    expect(renderMarkdown('## Repeat\n\n## Repeat')).toContain('id="repeat-1"')
  })

  it('idFromPath strips wiki/pages prefix and extension', () => {
    expect(idFromPath('wiki/pages/entities/foo.md')).toBe('entities/foo')
  })
})

describe('frontmatter parsing', () => {
  it('extracts header fields and body', () => {
    const raw = `---
title: "Alan Turing"
summary: "Computer scientist"
tags: [computing, math]
category: entities
sources: [biography.pdf]
updatedAt: "2026-08-16"
---

Body **text** here.`
    const { data, body } = parseFrontmatter(raw, 'fallback')
    expect(data.title).toBe('Alan Turing')
    expect(data.tags).toEqual(['computing', 'math'])
    expect(data.sources).toEqual(['biography.pdf'])
    expect(data.updatedAt).toBe('2026-08-16')
    expect(body.trim()).toBe('Body **text** here.')
  })

  it('falls back to the provided title when frontmatter is missing', () => {
    const { data } = parseFrontmatter('No frontmatter here.', 'fallback')
    expect(data.title).toBe('fallback')
    expect(data.tags).toEqual([])
  })
})

describe('graph svg', () => {
  it('renders nodes and edges into an svg', () => {
    const graph = buildGraph(fixtures.wikiDir)
    const svg = renderGraphSvg(graph)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Alan Turing')
    expect(svg).toContain('<line')
  })
})

// ---------------------------------------------------------------------------
// Integration: real server on an ephemeral port
// ---------------------------------------------------------------------------

const fixtures = (() => {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-serve-'))
  const pagesDir = path.join(wikiDir, 'wiki', 'pages')
  fs.mkdirSync(path.join(pagesDir, 'entities'), { recursive: true })
  fs.mkdirSync(path.join(pagesDir, 'concepts'), { recursive: true })
  fs.mkdirSync(path.join(wikiDir, 'raw'), { recursive: true })

  fs.writeFileSync(
    path.join(pagesDir, 'entities', 'alan-turing.md'),
    `---
title: "Alan Turing"
summary: "Father of theoretical computer science"
tags: [computing]
category: entities
updatedAt: "2026-08-01"
---

Turing machines relate to [[concepts/turing-completeness]].
`,
  )
  fs.writeFileSync(
    path.join(pagesDir, 'concepts', 'turing-completeness.md'),
    `---
title: "Turing Completeness"
summary: "A system that can compute anything computable"
tags: [theory]
category: concepts
updatedAt: "2026-08-02"
---

Defined via [Turing](../entities/alan-turing.md).
`,
  )
  return { wikiDir }
})()

const config = {
  wikiDir: fixtures.wikiDir,
  rawDir: path.join(fixtures.wikiDir, 'raw'),
} as unknown as AxiomConfig

let server: Server | null = null
let base = ''

async function ensureServer(): Promise<string> {
  if (!server) {
    server = await startServer({ config, port: 0, host: '127.0.0.1', quiet: true, staticDir: false })
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    base = `http://127.0.0.1:${port}`
  }
  return base
}

afterAll(() => {
  server?.close()
})

describe('serve integration', () => {
  it('healthz responds ok', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('dashboard lists pages and stats', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Wiki overview')
    expect(html).toContain('Alan Turing')
    expect(html).toContain('2</strong> pages')
  })

  it('page list groups by category', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/pages`)
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('id="entities"')
    expect(html).toContain('Turing Completeness')
  })

  it('renders a page with rewritten wiki-links', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/page/entities/alan-turing`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<h1>Alan Turing</h1>')
    expect(html).toContain('href="/page/concepts/turing-completeness"')
    expect(html).toContain('computing')
  })

  it('shows "Linked from" for pages with inbound wiki-links', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/page/concepts/turing-completeness`)
    const html = await res.text()
    expect(html).toContain('Linked from (1)')
    expect(html).toContain('href="/page/entities/alan-turing"')
  })

  it('omits the backlinks section when nothing links in', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/page/entities/alan-turing`)
    const html = await res.text()
    expect(html).not.toContain('Linked from')
  })

  it('404s for missing pages', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/page/entities/nope`)
    expect(res.status).toBe(404)
  })

  it('404s for path traversal attempts', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/page/%2e%2e/secret`)
    expect(res.status).toBe(404)
  })

  it('search finds matching pages', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/search?q=turing`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('results for')
    expect(html.toLowerCase()).toContain('turing')
  })

  it('empty search renders the placeholder', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/search`)
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('Type a query')
  })

  it('graph renders an svg', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/graph`)
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('<svg')
  })

  it('rejects non-GET methods (read-only)', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/pages`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('unknown routes get a friendly 404', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/whatever`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('Not found')
  })
})

// ---------------------------------------------------------------------------
// JSON API used by the React frontend (apps/web)
// ---------------------------------------------------------------------------

describe('json api', () => {
  it('overview returns status and recent pages', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/overview`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status.totalPages).toBe(2)
    expect(body.recent[0].title).toBeTruthy()
  })

  it('pages returns every page', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/pages`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pages).toHaveLength(2)
    expect(body.pages.map((p: { title: string }) => p.title)).toContain('Alan Turing')
  })

  it('page returns markdown html and backlinks', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/pages/concepts/turing-completeness`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('concepts/turing-completeness')
    expect(body.frontmatter.title).toBe('Turing Completeness')
    expect(body.html).toContain('href="/page/entities/alan-turing"')
    expect(body.backlinks).toEqual([{ fromId: 'entities/alan-turing', fromTitle: 'Alan Turing' }])
  })

  it('page 404s for a missing id', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/pages/entities/nope`)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('No wiki page')
  })

  it('page rejects traversal segments', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/pages/..%2F..%2Fsecret`)
    expect(res.status).toBe(404)
  })

  it('search returns matching sections', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/search?q=turing`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('turing')
    expect(body.results.length).toBeGreaterThan(0)
  })

  it('empty search returns no results', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/search`)
    expect(await res.json()).toEqual({ query: '', results: [] })
  })

  it('graph serializes nodes and edges as arrays', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/graph`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(body.nodes.map((n: { id: string }) => n.id)).toContain('entities/alan-turing')
    expect(body.edges.length).toBeGreaterThan(0)
    expect(body.orphans).toContain('entities/alan-turing')
  })

  it('rejects non-GET methods', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/pages`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('unknown api routes return a json 404', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/v1/nope`)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('No API route')
  })

  it('non-versioned api paths return a json 404', async () => {
    const b = await ensureServer()
    const res = await fetch(`${b}/api/nope`)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('/api/v1')
  })
})

// ---------------------------------------------------------------------------
// SPA static serving (built frontend)
// ---------------------------------------------------------------------------

describe('spa static serving', () => {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-'))
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><div id="root">spa</div>')
  fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("ok")')

  let spaServer: Server | null = null
  let spaBase = ''

  async function ensureSpaServer(): Promise<string> {
    if (!spaServer) {
      spaServer = await startServer({
        config,
        port: 0,
        host: '127.0.0.1',
        quiet: true,
        staticDir: webDir,
      })
      const addr = spaServer.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      spaBase = `http://127.0.0.1:${port}`
    }
    return spaBase
  }

  afterAll(() => {
    spaServer?.close()
  })

  it('serves index.html at the root', async () => {
    const b = await ensureSpaServer()
    const res = await fetch(`${b}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
  })

  it('falls back to index.html for client routes', async () => {
    const b = await ensureSpaServer()
    for (const route of ['/pages', '/page/entities/alan-turing', '/graph', '/whatever']) {
      const res = await fetch(`${b}${route}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('id="root"')
    }
  })

  it('serves hashed assets with immutable caching', async () => {
    const b = await ensureSpaServer()
    const res = await fetch(`${b}/assets/app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('404s missing assets instead of returning html', async () => {
    const b = await ensureSpaServer()
    const res = await fetch(`${b}/assets/missing.js`)
    expect(res.status).toBe(404)
  })

  it('keeps the json api working alongside the spa', async () => {
    const b = await ensureSpaServer()
    const res = await fetch(`${b}/api/v1/pages`)
    expect(res.status).toBe(200)
    expect((await res.json()).pages).toHaveLength(2)
  })
})
