import { render } from 'ink'
import React from 'react'
import { InitScreen } from './screens/init.js'
import { IngestScreen } from './screens/ingest.js'
import { QueryScreen } from './screens/query.js'
import { HomeScreen } from './screens/home.js'
import { StatusScreen } from './screens/status.js'
import { ModelScreen } from './screens/model.js'
import { WatchScreen } from './screens/watch.js'
import { ClipScreen } from './screens/clip.js'
import { SourcesScreen } from './screens/sources.js'
import { ReviewScreen } from './screens/review.js'
import { GraphScreen } from './screens/graph.js'
import { MapScreen } from './screens/map.js'
import { SyncScreen } from './screens/sync.js'
import { SetupAgentScreen } from './screens/setup-agent.js'

export type AxiomCommand =
  | { name: 'init' }
  | { name: 'ingest'; file?: string; interactive?: boolean }
  | { name: 'query' }
  | { name: 'home' }
  | { name: 'status' }
  | { name: 'model' }
  | { name: 'watch' }
  | { name: 'clip'; url?: string }
  | { name: 'sources' }
  | { name: 'review' }
  | { name: 'graph' }
  | { name: 'map' }
  | { name: 'sync' }
  | { name: 'setup-agent' }

export function renderApp(command: AxiomCommand): void {
  switch (command.name) {
    case 'init':
      render(<InitScreen />)
      break
    case 'ingest':
      render(<IngestScreen file={command.file} interactive={command.interactive} />)
      break
    case 'query':
      render(<QueryScreen />)
      break
    case 'home':
      render(<HomeScreen />)
      break
    case 'status':
      render(<StatusScreen />)
      break
    case 'model':
      render(<ModelScreen />)
      break
    case 'watch':
      render(<WatchScreen />)
      break
    case 'clip':
      render(<ClipScreen url={command.url} />)
      break
    case 'sources':
      render(<SourcesScreen />)
      break
    case 'review':
      render(<ReviewScreen />)
      break
    case 'graph':
      render(<GraphScreen />)
      break
    case 'map':
      render(<MapScreen />)
      break
    case 'sync':
      render(<SyncScreen />)
      break
    case 'setup-agent':
      render(<SetupAgentScreen />)
      break
    default: {
      const _exhaustive: never = command
      void _exhaustive
    }
  }
}
