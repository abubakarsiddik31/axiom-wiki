import { api } from '../api'
import { useJobs } from '../hooks'
import type { Job } from '../types'
import { CloseIcon } from './Icons'

const ACTIVE = new Set(['queued', 'running'])

function statusTone(status: Job['status']): string {
  if (status === 'running') return 'text-cyan'
  if (status === 'queued') return 'text-graphite'
  if (status === 'succeeded') return 'text-cyan'
  if (status === 'cancelled') return 'text-amber'
  return 'text-danger'
}

export function JobTray({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return null

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.16em] text-graphite">
        <span>jobs</span>
        <span>{jobs.filter((job) => ACTIVE.has(job.status)).length} active</span>
      </div>
      <ul className="space-y-1.5">
        {jobs.slice(0, 4).map((job) => {
          const lastLine = job.lines[job.lines.length - 1]
          return (
            <li key={job.id} className="border border-line bg-space/50 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[0.62rem] text-ghost" title={job.action}>
                  {job.action}
                </span>
                {ACTIVE.has(job.status) ? (
                  <button
                    type="button"
                    onClick={() => void api.cancelJob(job.id)}
                    className="text-graphite hover:text-danger"
                    aria-label={`Cancel ${job.action}`}
                  >
                    <CloseIcon size={11} />
                  </button>
                ) : (
                  <span className={`font-mono text-[0.58rem] uppercase ${statusTone(job.status)}`}>
                    {job.status}
                  </span>
                )}
              </div>
              {job.error ? (
                <p className="mt-0.5 truncate font-mono text-[0.58rem] text-danger" title={job.error}>
                  {job.error}
                </p>
              ) : lastLine ? (
                <p className="mt-0.5 truncate font-mono text-[0.58rem] text-graphite" title={lastLine}>
                  {lastLine}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function JobTrayLive() {
  const { data } = useJobs()
  return <JobTray jobs={data?.jobs ?? []} />
}
