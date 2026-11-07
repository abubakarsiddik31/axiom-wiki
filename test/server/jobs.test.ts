import { describe, it, expect, vi } from 'vitest'

import { JobManager } from '../../src/server/jobs.js'

describe('JobManager', () => {
  it('runs a job, streams logs and deltas, and stores the result', async () => {
    const manager = new JobManager()
    const created = manager.create('demo')
    const events: string[] = []
    manager.subscribe(created.id, (event) => events.push(event.type))

    manager.start(created.id, async ({ log, delta }) => {
      log('working')
      delta('hello')
      return { ok: true }
    })

    await vi.waitFor(() => {
      expect(manager.get(created.id)?.status).toBe('succeeded')
    })

    const job = manager.get(created.id)
    expect(job?.result).toEqual({ ok: true })
    expect(job?.lines).toContain('working')
    expect(events).toContain('snapshot')
    expect(events).toContain('log')
    expect(events).toContain('delta')
    expect(events).toContain('done')
  })

  it('marks a failed runner as failed with the error message', async () => {
    const manager = new JobManager()
    const created = manager.create('fail')
    manager.start(created.id, async () => {
      throw new Error('boom')
    })

    await vi.waitFor(() => {
      expect(manager.get(created.id)?.status).toBe('failed')
    })
    expect(manager.get(created.id)?.error).toBe('boom')
  })

  it('cancels a running job', async () => {
    const manager = new JobManager()
    const created = manager.create('cancel')

    let signal: AbortSignal | null = null
    manager.start(created.id, async (context) => {
      signal = context.signal
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { ok: true }
    })

    manager.cancel(created.id)
    await vi.waitFor(() => {
      expect(manager.get(created.id)?.status).toBe('cancelled')
    })
    expect(signal?.aborted).toBe(true)
  })

  it('returns null for an unknown job', () => {
    const manager = new JobManager()
    expect(manager.get('missing')).toBeNull()
    expect(manager.cancel('missing')).toBeNull()
  })
})
