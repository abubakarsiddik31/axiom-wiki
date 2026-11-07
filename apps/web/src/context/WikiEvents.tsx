import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { WIKI_EVENTS_URL } from '../api'

/**
 * A monotonically increasing counter bumped whenever the server reports that
 * the Markdown corpus changed. `useAsync` includes it in its dependency list,
 * so every mounted view refreshes after an ingest without polling.
 */
const WikiEventsContext = createContext(0)

export function WikiEventsProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(WIKI_EVENTS_URL)
    source.addEventListener('wiki-changed', () => setVersion((value) => value + 1))
    // EventSource reconnects on its own; closing on unmount is all we need.
    return () => source.close()
  }, [])

  return <WikiEventsContext.Provider value={version}>{children}</WikiEventsContext.Provider>
}

export function useWikiVersion(): number {
  return useContext(WikiEventsContext)
}
