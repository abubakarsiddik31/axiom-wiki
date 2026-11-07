import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { WikiReadCache } from '../../src/server/cache.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-cache-'))
const pagesDir = path.join(root, 'wiki', 'pages', 'entities')
fs.mkdirSync(pagesDir, { recursive: true })

function writePage(name: string, title: string): void {
  fs.writeFileSync(
    path.join(pagesDir, `${name}.md`),
    `---\ntitle: "${title}"\ncategory: entities\n---\n\nBody.\n`,
  )
}

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('WikiReadCache', () => {
  it('reuses a warm snapshot and rebuilds after invalidation', async () => {
    writePage('first', 'First')
    const cache = new WikiReadCache(root)
    cache.start()
    await cache.whenReady()

    try {
      const first = await cache.get()
      expect(first.pages.map((p) => p.title)).toContain('First')
      expect(await cache.get()).toBe(first)

      cache.invalidate()
      const rebuilt = await cache.get()
      expect(rebuilt).not.toBe(first)
    } finally {
      await cache.close()
    }
  })

  it(
    'invalidates when a page is written',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-cache-watch-'))
      const pages = path.join(dir, 'wiki', 'pages', 'entities')
      fs.mkdirSync(pages, { recursive: true })
      fs.writeFileSync(path.join(pages, 'one.md'), '---\ntitle: One\ncategory: entities\n---\n')

      const cache = new WikiReadCache(dir, { ttlMs: 500 })
      cache.start()
      await cache.whenReady()

      try {
        expect((await cache.get()).pages).toHaveLength(1)
        fs.writeFileSync(path.join(pages, 'two.md'), '---\ntitle: Two\ncategory: entities\n---\n')

        await vi.waitFor(
          async () => {
            expect((await cache.get()).pages).toHaveLength(2)
          },
          { timeout: 5000, interval: 100 },
        )
      } finally {
        await cache.close()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
    // Must exceed the vi.waitFor timeout; the default test timeout is 5s.
    10000,
  )
})
