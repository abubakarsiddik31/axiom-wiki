import path from 'path'
import type { FSWatcher } from 'chokidar'

import type { AxiomConfig } from '../config/index.js'
import { startWatcher } from '../core/watcher.js'
import { ingest } from '../core/ingest.js'
import type { JobManager } from './jobs.js'

export interface WatchStatus {
  running: boolean
  startedAt: string | null
  lastEvent: {
    at: string
    file: string
    jobId: string
  } | null
}

/**
 * Watches `raw/` for dropped files and compiles each one as a job.
 *
 * This is the same chokidar watcher the CLI uses; the web version adds a job
 * per file so the browser can show progress and a stop/start toggle. Starting
 * the watcher is a write action because it will compile files while it runs.
 */
export class WatchController {
  private watcher: FSWatcher | null = null
  private startedAt: string | null = null
  private lastEvent: WatchStatus['lastEvent'] = null

  constructor(
    private readonly config: AxiomConfig,
    private readonly jobs: JobManager,
  ) {}

  status(): WatchStatus {
    return {
      running: Boolean(this.watcher),
      startedAt: this.startedAt,
      lastEvent: this.lastEvent,
    }
  }

  start(): WatchStatus {
    if (this.watcher) return this.status()

    this.watcher = startWatcher(this.config.rawDir, async (filepath) => {
      const filename = path.basename(filepath)
      const job = this.jobs.create(`watch: ${filename}`)
      this.lastEvent = {
        at: new Date().toISOString(),
        file: filename,
        jobId: job.id,
      }
      this.jobs.start(job.id, ({ log, signal }) =>
        ingest(this.config, { file: filename }, { onStatus: log, signal }),
      )
    })
    this.startedAt = new Date().toISOString()
    return this.status()
  }

  async stop(): Promise<WatchStatus> {
    const watcher = this.watcher
    this.watcher = null
    this.startedAt = null
    await watcher?.close()
    return this.status()
  }
}
