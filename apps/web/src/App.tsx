import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { Overview } from './pages/Overview'
import { Pages } from './pages/Pages'
import { PageView } from './pages/PageView'
import { Search } from './pages/Search'
import { Graph } from './pages/Graph'
import { Sources } from './pages/Sources'
import { Query } from './pages/Query'
import { Integrity } from './pages/Integrity'
import { Settings } from './pages/Settings'
import { PageEditor } from './pages/PageEditor'
import { PageHistory } from './pages/PageHistory'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="pages" element={<Pages />} />
        <Route path="new" element={<PageEditor />} />
        <Route path="edit/*" element={<PageEditor />} />
        <Route path="history/*" element={<PageHistory />} />
        <Route path="page/*" element={<PageView />} />
        <Route path="search" element={<Search />} />
        <Route path="graph" element={<Graph />} />
        <Route path="ask" element={<Query />} />
        <Route path="sources" element={<Sources />} />
        <Route path="integrity" element={<Integrity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
