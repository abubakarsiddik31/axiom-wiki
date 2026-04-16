import path from 'path'
import { pageCoversFile, type MapState, type MapPageEntry } from './sync.js'
import { readPage, writePage } from './wiki.js'

export interface FileChange {
  path: string
  type: 'created' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
}

export interface Tier1Result {
  updatedPages: string[]
  flaggedStale: string[]
  referenceUpdates: Array<{ page: string; oldRef: string; newRef: string }>
}

export async function applyTier1Updates(
  wikiDir: string,
  changes: FileChange[],
  mapState: MapState,
): Promise<Tier1Result> {
  const updatedPages: string[] = []
  const flaggedStale: string[] = []
  const referenceUpdates: Array<{ page: string; oldRef: string; newRef: string }> = []

  for (const change of changes) {
    switch (change.type) {
      case 'renamed': {
        if (!change.oldPath) break
        for (const page of mapState.pages) {
          const idx = page.paths.indexOf(change.oldPath)
          if (idx === -1 && !pageCoversFile(page, change.oldPath)) continue

          // Update paths array
          if (idx !== -1) {
            page.paths[idx] = change.path
          }

          // Update page content references
          const pagePath = resolvePagePath(page)
          try {
            const content = await readPage(wikiDir, pagePath)
            if (content.includes(change.oldPath)) {
              const updated = content.replaceAll(change.oldPath, change.path)
              await writePage(wikiDir, pagePath, updated)
              updatedPages.push(page.slug)
              referenceUpdates.push({ page: page.slug, oldRef: change.oldPath, newRef: change.path })
            }
          } catch {
            // Page may not exist yet
          }
        }
        break
      }

      case 'deleted': {
        for (const page of mapState.pages) {
          if (!pageCoversFile(page, change.path)) continue
          const current = page._confidence ?? 1.0
          page._confidence = Math.max(0.1, current - 0.3)
          flaggedStale.push(page.slug)
        }
        break
      }

      case 'created': {
        const parentDir = path.dirname(change.path)
        for (const page of mapState.pages) {
          const covers = page.paths.some((p) => {
            if (p.endsWith('/')) return change.path.startsWith(p)
            return p === parentDir || change.path.startsWith(p + '/')
          })
          if (covers && !page.paths.includes(change.path)) {
            // Don't add individual files to paths — just flag for Tier 2
            const current = page._confidence ?? 1.0
            page._confidence = Math.max(0.1, current - 0.1)
            flaggedStale.push(page.slug)
          }
        }
        break
      }

      case 'modified': {
        for (const page of mapState.pages) {
          if (!pageCoversFile(page, change.path)) continue
          const current = page._confidence ?? 1.0
          page._confidence = Math.max(0.1, current - 0.15)
          flaggedStale.push(page.slug)
        }
        break
      }
    }
  }

  return {
    updatedPages: [...new Set(updatedPages)],
    flaggedStale: [...new Set(flaggedStale)],
    referenceUpdates,
  }
}

function resolvePagePath(page: MapPageEntry): string {
  return `wiki/pages/${page.category}/${page.slug}.md`
}
