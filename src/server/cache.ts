import path from 'path'
import { watch, type FSWatcher } from 'chokidar'

import { buildWikiSnapshot, type WikiSnapshot } from '../core/snapshot.js'

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
  private snapshot: WikiSnapshot | null = null
  private builtAt = 0
  private inflight: Promise<WikiSnapshot> | null = null
  private watcher: FSWatcher | null = null
  private closed = false
  private ready: Promise<void> = Promise.resolve()

  constructor(wikiDir: string, options?: { ttlMs?: number }) {
    this.wikiDir = wikiDir
    // Safety net if the watcher misses an event (network filesystems, fsevents
    // hiccups). The watcher is still the primary invalidation path.
    this.ttlMs = options?.ttlMs ?? 5 * 60_000
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
    this.watcher.on('all', () => {
      this.snapshot = null
    })
    this.watcher.on('error', () => {
      // A watcher failure must not poison reads; the next request rebuilds.
      this.snapshot = null
    })
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

  invalidate(): void {
    this.snapshot = null
    this.builtAt = 0
  }

  async close(): Promise<void> {
    this.closed = true
    this.snapshot = null
    const watcher = this.watcher
    this.watcher = null
    await watcher?.close()
  }
}
