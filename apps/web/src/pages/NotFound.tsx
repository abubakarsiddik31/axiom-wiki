import { Link } from 'react-router-dom'

import { EmptyState } from '../components/ui'
import { useTitle } from '../hooks'
import { ArrowRightIcon } from '../components/Icons'

export function NotFound() {
  useTitle('Not found')
  return (
    <div className="fade-up">
      <EmptyState
        title="Nothing here"
        action={
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ghost hover:border-cyan hover:text-cyan"
          >
            Back to overview <ArrowRightIcon size={12} />
          </Link>
        }
      >
        That route does not exist in this wiki UI.
      </EmptyState>
    </div>
  )
}
