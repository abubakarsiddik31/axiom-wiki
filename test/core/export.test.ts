import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'

import { exportSite } from '../../src/core/export.js'

function writePage(
  wikiDir: string,
  id: string,
  data: Record<string, unknown>,
  body: string,
): void {
  const abs = path.join(wikiDir, 'wiki/pages', `${id}.md`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, matter.stringify(`${body}\n`, data), 'utf-8')
}

describe('static export', () => {
  let wikiDir: string
  let outDir: string

  beforeEach(() => {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-export-'))
    outDir = path.join(wikiDir, 'site')

    writePage(
      wikiDir,
      'concepts/logic',
      {
        title: 'Logic',
        summary: 'The study of valid inference.',
        tags: ['logic', 'philosophy'],
        category: 'concepts',
        updatedAt: '2026-01-02',
      },
      '# Logic\n\nLogic studies **valid inference** and is used by [[concepts/computation|computation]]. ^[sep.pdf#p. 1]\n\n## Inference\n\nInference is the core move.\n\n## History\n\nLogic is old. It also mentions [[concepts/ghost]], [[entities/alan-turing|Turing]], and [[inbox/idea]].\n\n![Diagram](diagram.png)\n\n![Data](data.json)',
    )
    writePage(
      wikiDir,
      'concepts/computation',
      {
        title: 'Computation',
        summary: 'What machines do.',
        tags: ['logic', 'computation'],
        category: 'concepts',
        updatedAt: '2026-01-03',
      },
      'Computation links back to [[concepts/logic]].',
    )
    writePage(
      wikiDir,
      'entities/alan-turing',
      {
        title: 'Alan Turing',
        summary: 'Mathematician.',
        tags: ['computing'],
        category: 'entities',
        updatedAt: '2026-01-04',
      },
      'Alan Turing proposed the Turing machine.',
    )
    writePage(
      wikiDir,
      'inbox/idea',
      {
        title: 'Private idea',
        summary: 'Not for the public site.',
        tags: ['inbox'],
        category: 'inbox',
        updatedAt: '2026-01-05',
      },
      'A private thought.',
    )

    fs.writeFileSync(path.join(wikiDir, 'wiki/pages/concepts/diagram.png'), Buffer.from('png-bytes'))
    fs.writeFileSync(path.join(wikiDir, 'wiki/pages/concepts/data.json'), '{"secret":true}')
  })

  afterEach(() => {
    fs.rmSync(wikiDir, { recursive: true, force: true })
  })

  function read(...segments: string[]): string {
    return fs.readFileSync(path.join(outDir, ...segments), 'utf-8')
  }

  it('writes the site, excludes inbox notes, and reports a summary', () => {
    const result = exportSite(wikiDir, { outDir, title: 'Notes' })

    expect(result.pages).toBe(3)
    expect(result.excludedInbox).toBe(1)
    expect(result.categories).toEqual({ concepts: 2, entities: 1 })
    expect(result.media).toBe(1)
    expect(result.deadLinks).toBe(1)
    expect(fs.existsSync(path.join(outDir, 'assets/media'))).toBe(true)
    const mediaFiles = fs.readdirSync(path.join(outDir, 'assets/media'))
    expect(mediaFiles.some((file) => file.endsWith('-diagram.png'))).toBe(true)
    expect(mediaFiles.some((file) => file.includes('data.json'))).toBe(false)

    expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'pages.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'search.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'graph.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, '404.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'assets/style.css'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, '.axiom-export.json'))).toBe(true)

    const pages = read('pages.html')
    expect(pages).not.toContain('Private idea')
    expect(pages).not.toContain('inbox/idea')
    expect(pages).toContain('data-filter-text')
    expect(pages).toContain('id="filter"')
  })

  it('renders a page with relative links, citations, dead links, and backlinks', () => {
    exportSite(wikiDir, { outDir, title: 'Notes' })
    const html = read('p/concepts/logic.html')

    expect(html).toContain('<h1>Logic</h1>')
    expect(html).not.toContain('<h1>Logic</h1>\n<p>Logic studies')
    expect(html).toContain('<strong>valid inference</strong>')
    expect(html).toContain('href="computation.html"')
    expect(html).toContain('href="../entities/alan-turing.html"')
    expect(html).toContain('class="citation"')
    expect(html).toContain('sep.pdf')
    expect(html).toContain('class="dead"')
    expect(html).toContain('Missing page: p/concepts/ghost.html')
    expect(html).toContain('dead private')
    expect(html).toContain('Not exported (inbox note)')

    expect(html).toContain('id="inference"')
    expect(html).toContain('href="#inference"')
    expect(html).toContain('On this page')

    expect(html).toContain('Linked from')
    expect(html).toContain('href="computation.html"')
    expect(html).toContain('Links out')

    expect(html).toContain('../../index.html')
    expect(html).toContain('../../assets/style.css')
    expect(html).toContain('<img src="../../assets/media/')
  })

  it('builds an offline search index and page', () => {
    exportSite(wikiDir, { outDir, title: 'Notes' })
    const html = read('search.html')

    expect(html).toContain('var INDEX =')
    expect(html).toContain('Logic')
    expect(html).toContain('"href":"p/concepts/logic.html"')
    expect(html).toContain('Search titles, tags, and text')
  })

  it('renders the graph and lists orphans and dead links', () => {
    exportSite(wikiDir, { outDir, title: 'Notes' })
    const html = read('graph.html')

    expect(html).toContain('<svg')
    expect(html).toContain('Page graph')
    expect(html).toContain('concepts/ghost')
  })

  it('refuses to overwrite a non-empty directory unless forced', () => {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'keep.txt'), 'do not delete')

    expect(() => exportSite(wikiDir, { outDir })).toThrow(/Refusing to overwrite/)

    const result = exportSite(wikiDir, { outDir, force: true })
    expect(result.pages).toBe(3)
    expect(fs.existsSync(path.join(outDir, 'keep.txt'))).toBe(false)
  })

  it('re-exports over its own output directory', () => {
    exportSite(wikiDir, { outDir })
    const result = exportSite(wikiDir, { outDir })
    expect(result.pages).toBe(3)
  })

  it('writes a sitemap and canonical tags when a base URL is set', () => {
    exportSite(wikiDir, { outDir, baseUrl: 'https://example.com/notes/' })

    const sitemap = read('sitemap.xml')
    expect(sitemap).toContain('<loc>https://example.com/notes/p/concepts/logic.html</loc>')
    expect(sitemap).toContain('<loc>https://example.com/notes/</loc>')

    expect(read('robots.txt')).toContain('Sitemap: https://example.com/notes/sitemap.xml')

    const html = read('p/concepts/logic.html')
    expect(html).toContain('<link rel="canonical" href="https://example.com/notes/p/concepts/logic.html">')
  })
})
