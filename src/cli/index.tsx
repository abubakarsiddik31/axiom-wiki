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

export type AxiomCommand =
  | { name: 'init' }
  | { name: 'ingest'; file?: string }
  | { name: 'query' }
  | { name: 'home' }
  | { name: 'status' }
  | { name: 'model' }
  | { name: 'watch' }
  | { name: 'clip'; url?: string }
  | { name: 'sources' }

export function renderApp(command: AxiomCommand): void {
  switch (command.name) {
    case 'init':
      render(<InitScreen />)
      break
    case 'ingest':
      render(<IngestScreen file={command.file} />)
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
    default: {
      const _exhaustive: never = command
      void _exhaustive
    }
  }
}
