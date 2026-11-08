import path from 'path'
import { watch, type FSWatcher } from 'chokidar'

import { buildWikiSnapshot, type WikiSnapshot } from '../core/snapshot.js'
import { buildLinkIndex, type PageLinkEntry } from '../core/links.js'

/**
 * Process-local read cache for the web server.
 *
 * The wiki is compiled to Markdown on disk, and CLI/agent writes are atomic
 * renames, so a single watcher over `wiki/` is enough to keep this coherent.
 * Reads become O(1) after the first request and rebuild once per change instead
 * of once per request (which is what `listPages`/`buildGraph` did before).
 */
export class WikiReadCache {
  private readonly wikiDir: string
  private readonly ttlMs: number
  private readonly debounceMs: number
  private snapshot: WikiSnapshot | null = null
  private builtAt = 0
  private inflight: Promise<WikiSnapshot> | null = null
  private linkIndex: Map<string, PageLinkEntry> | null = null
  private watcher: FSWatcher | null = null
  private invalidateTimer: NodeJS.Timeout | null = null
  private readonly changeListeners = new Set<() => void>()
  private closed = false
  private ready: Promise<void> = Promise.resolve()

  constructor(wikiDir: string, options?: { ttlMs?: number; debounceMs?: number }) {
    this.wikiDir = wikiDir
    // Safety net if the watcher misses an event (network filesystems, fsevents
    // hiccups). The watcher is still the primary invalidation path.
    this.ttlMs = options?.ttlMs ?? 5 * 60_000
    // An ingest writes many pages in quick succession. Coalesce those events so
    // a bulk write rebuilds the snapshot once instead of once per page.
    this.debounceMs = options?.debounceMs ?? 150
  }

  start(): void {
    if (this.watcher || this.closed) return
    // Watch the pages directory itself: every event there changes the
    // snapshot, and we avoid log/index writes plus any path-prefix comparison
    // (which is unreliable across the macOS /var -> /private/var symlink).
    this.watcher = watch(path.join(this.wikiDir, 'wiki', 'pages'), {
      ignoreInitial: true,
      persistent: true,
    })
    this.ready = new Promise((resolve) => {
      this.watcher?.once('ready', () => resolve())
    })
    this.watcher.on('all', () => this.scheduleInvalidate())
    this.watcher.on('error', () => {
      // A watcher failure must not poison reads; the next request rebuilds.
      this.scheduleInvalidate()
    })
  }

  /**
   * Defers invalidation until the current burst of writes settles. Requests
   * during the debounce window keep serving the warm snapshot — a few hundred
   * milliseconds of staleness is preferable to re-parsing the corpus for every
   * page an ingest touches.
   */
  private scheduleInvalidate(): void {
    if (this.closed) return
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer)
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = null
      this.snapshot = null
      this.linkIndex = null
      this.builtAt = 0
      this.notifyChange()
    }, this.debounceMs)
    // Never keep the process alive just to expire a cache entry.
    this.invalidateTimer.unref?.()
  }

  /**
   * Subscribe to "the Markdown corpus changed" notifications. Used by the SSE
   * endpoint; listeners are called after the debounce burst settles.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  private notifyChange(): void {
    if (this.closed) return
    for (const listener of this.changeListeners) {
      try {
        listener()
      } catch {
        // A broken subscriber must not break the cache.
      }
    }
  }

  /** Resolves once chokidar has completed its initial scan. */
  whenReady(): Promise<void> {
    return this.ready
  }

  get(): Promise<WikiSnapshot> {
    if (this.closed) return Promise.resolve(buildWikiSnapshot(this.wikiDir))
    if (this.snapshot && Date.now() - this.builtAt < this.ttlMs) {
      return Promise.resolve(this.snapshot)
    }
    if (!this.inflight) {
      this.inflight = Promise.resolve()
        .then(() => {
          const snapshot = buildWikiSnapshot(this.wikiDir)
          this.snapshot = snapshot
          this.builtAt = Date.now()
          this.inflight = null
          return snapshot
        })
        .catch((err: unknown) => {
          this.inflight = null
          throw err
        })
    }
    return this.inflight
  }

  /**
   * Corpus-wide link index, built once per snapshot generation. Link
   * intelligence is O(pages) in I/O, so serving it from the same invalidation
   * cycle as the snapshot keeps page views flat instead of re-reading every
   * page for each request.
   */
  getLinkIndex(): Map<string, PageLinkEntry> {
    if (this.closed) return buildLinkIndex(this.wikiDir)
    if (!this.linkIndex) this.linkIndex = buildLinkIndex(this.wikiDir)
    return this.linkIndex
  }

  /**
   * Drops cached derivations without emitting an SSE change. Used after a write
   * that the caller already knows about, so an immediate re-read (for example
   * the link panel after linking a mention) is not served stale.
   */
  refresh(): void {
    this.snapshot = null
    this.linkIndex = null
    this.builtAt = 0
  }

  invalidate(): void {
    if (this.invalidateTimer) {
      clearTimeout(this.invalidateTimer)
      this.invalidateTimer = null
    }
    this.snapshot = null
    this.linkIndex = null
    this.builtAt = 0
    this.notifyChange()
  }

  async close(): Promise<void> {
    this.closed = true
    this.invalidate()
    const watcher = this.watcher
    this.watcher = null
    await watcher?.close()
  }
}
