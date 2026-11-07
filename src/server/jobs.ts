import crypto from 'crypto'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface JobPublic {
  id: string
  action: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  lines: string[]
  result: unknown
  error: string | null
}

export type JobEvent =
  | { type: 'snapshot'; job: JobPublic }
  | { type: 'status'; job: JobPublic }
  | { type: 'log'; id: string; line: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; job: JobPublic }

export interface JobContext {
  log: (line: string) => void
  delta: (text: string) => void
  signal: AbortSignal
}

type Listener = (event: JobEvent) => void

interface JobRecord {
  id: string
  action: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  lines: string[]
  result: unknown
  error: string | null
  controller: AbortController | null
  listeners: Set<Listener>
}

const MAX_LINES = 200
const KEEP_FINISHED_MS = 30 * 60_000

function toPublic(job: JobRecord): JobPublic {
  return {
    id: job.id,
    action: job.action,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lines: [...job.lines],
    result: job.result,
    error: job.error,
  }
}

/**
 * Process-local job registry for long-running actions (ingest, clip, query,
 * reindex). Jobs disappear on restart by design — the wiki files are the only
 * durable state.
 */
export class JobManager {
  private readonly jobs = new Map<string, JobRecord>()

  create(action: string): JobPublic {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      action,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      lines: [],
      result: null,
      error: null,
      controller: null,
      listeners: new Set(),
    }
    this.jobs.set(job.id, job)
    this.prune()
    return toPublic(job)
  }

  start(
    id: string,
    runner: (context: JobContext) => Promise<unknown>,
  ): void {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'queued') return

    job.status = 'running'
    job.startedAt = new Date().toISOString()
    job.controller = new AbortController()
    this.emit(job, { type: 'status', job: toPublic(job) })

    const context: JobContext = {
      log: (line) => this.log(id, line),
      delta: (text) => {
        if (job.status !== 'running') return
        this.emit(job, { type: 'delta', id, text })
      },
      signal: job.controller.signal,
    }

    void Promise.resolve()
      .then(() => runner(context))
      .then((result) => {
        if (job.status === 'cancelled') return
        job.status = 'succeeded'
        job.result = result
      })
      .catch((err: unknown) => {
        if (job.status === 'cancelled' || job.controller?.signal.aborted) {
          job.status = 'cancelled'
          job.error = 'Cancelled.'
        } else {
          job.status = 'failed'
          job.error = err instanceof Error ? err.message : String(err)
        }
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString()
        job.controller = null
        if (job.status === 'cancelled' && !job.error) job.error = 'Cancelled.'
        if (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled') {
          job.status = 'failed'
        }
        this.emit(job, { type: 'done', job: toPublic(job) })
      })
  }

  get(id: string): JobPublic | null {
    this.prune()
    const job = this.jobs.get(id)
    return job ? toPublic(job) : null
  }

  list(): JobPublic[] {
    this.prune()
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublic)
  }

  cancel(id: string): JobPublic | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.status === 'queued') {
      job.status = 'cancelled'
      job.finishedAt = new Date().toISOString()
      job.error = 'Cancelled.'
      this.emit(job, { type: 'done', job: toPublic(job) })
    } else if (job.status === 'running') {
      job.status = 'cancelled'
      job.error = 'Cancelled.'
      job.controller?.abort()
    }
    return toPublic(job)
  }

  subscribe(id: string, listener: Listener): () => void {
    const job = this.jobs.get(id)
    if (!job) return () => {}
    job.listeners.add(listener)
    listener({ type: 'snapshot', job: toPublic(job) })
    return () => {
      job.listeners.delete(listener)
    }
  }

  private log(id: string, line: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.lines.push(line)
    if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
    this.emit(job, { type: 'log', id, line })
  }

  private emit(job: JobRecord, event: JobEvent): void {
    for (const listener of job.listeners) {
      try {
        listener(event)
      } catch {
        // A broken SSE client must not take down the job.
      }
    }
  }

  private prune(): void {
    const cutoff = Date.now() - KEEP_FINISHED_MS
    for (const [id, job] of this.jobs) {
      if (!job.finishedAt) continue
      if (new Date(job.finishedAt).getTime() < cutoff) this.jobs.delete(id)
    }
  }
}

export const jobs = new JobManager()
