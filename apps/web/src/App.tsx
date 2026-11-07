import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { Overview } from './pages/Overview'
import { Pages } from './pages/Pages'
import { PageView } from './pages/PageView'
import { Search } from './pages/Search'
import { Graph } from './pages/Graph'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="pages" element={<Pages />} />
        <Route path="page/*" element={<PageView />} />
        <Route path="search" element={<Search />} />
        <Route path="graph" element={<Graph />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
