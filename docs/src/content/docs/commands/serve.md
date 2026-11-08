---
title: serve
description: Browse, curate, and query the wiki in a local web app with a JSON API.
---

```bash
axiom-wiki serve
axiom-wiki serve --port 3000 --open
axiom-wiki serve --host 0.0.0.0   # expose on your LAN
axiom-wiki serve --allow-write --maintain-interval 1440   # nightly maintenance in-process
axiom-wiki serve --allow-write --scout --scout-port 1719  # also run Scout intake
```

Starts a local web server (default `http://127.0.0.1:1717`) that serves the **Axiom web app** from `dist/web` plus a read-only JSON API under `/api/v1`.

## The web app

The frontend lives in `apps/web` (Vite + React + TypeScript + Tailwind) and ships pre-built in the npm package, so `axiom-wiki serve` needs no extra install or second process:

- **Overview** — page and source counts, wiki size, last ingest, semantic index health, pages by category, and the ten most recently updated pages.
- **Pages** — every page, filterable by category, tag, or text, with paging and a recently-updated sort.
- **Page view** — rendered Markdown with frontmatter (tags, sources, updatedAt), rewritten wiki-links, citation pills, and three link panels: **Linked from** (what links here), **Mentions, not links** (unlinked mentions with one-click linking), and **Related** (shared tags, links, and sources).
- **Page authoring** — create and edit pages in the browser with a Markdown editor and server-rendered preview; rename (rewriting every inbound link), merge duplicates, and delete.
- **History** — per-page commit log with unified diffs and one-click restore. Every page write is committed, so changes are auditable and reversible.
- **Search** — the same hybrid search the CLI uses (lexical + semantic when embeddings are enabled), with section badges and highlighted snippets.
- **Graph** — the page link graph with zoom, pan, and clickable nodes; orphan pages are dashed and dead links are listed alongside.
- **Inbox** — one-line capture with an optional title and tags, then triage: **Promote** into a real category (a rename that rewrites links) or **Merge** into an existing page. A nav badge shows what is waiting.
- **Scout** — the always-on intake queue: paste a link, a thread, or a note; watch the queue drain; retry failures; copy the share endpoint and token; or check the drop folder. A nav badge shows what is queued. See [`scout`](/commands/scout).
- **Ask** — retrieves the most relevant pages, expands them one hop through the link graph, and answers from that evidence; optionally in forensic mode, then file the answer as an analysis page. Press **what will it read?** to preview the exact pages and token estimate before asking.
- **Sources** — list compiled sources, clip a URL, ingest a file from `raw/`, re-ingest, delete, or start a watcher that auto-ingests dropped files.
- **Integrity** — dead links, orphans, metadata gaps, unresolved contradictions, citation audit, and agent lint. Its **Maintenance** panel previews and applies the same deterministic pass as `axiom-wiki maintain`: backfill missing summaries, adopt orphans, propose duplicates, and optionally create stubs for dead links.
- **Settings** — provider/model, embeddings status, `obsidianCompat`, forensic mode, and semantic-index rebuild. The **Reranker** panel configures the provider (`local`, `llm`, `cohere`, `none`), local model, candidate/top-N limits, and the Cohere key, and can download or test a local model.

Live views listen to `GET /api/v1/events` and refresh when an ingest or agent write lands.

Content is read fresh from disk on every request — `watch`, `ingest`, and agent writes are reflected immediately.

## JSON API

The UI is a client of the same API, which you can call directly:

| Route | Returns |
|---|---|
| `GET /api/v1/overview` | `{ status, recent, inboxCount, scoutPending }` |
| `GET /api/v1/pages` | `{ pages, total, nextCursor, facets }` (optional `cat`, `tag`, `q`, `sort`, `cursor`, `limit`) |
| `GET /api/v1/pages/:category/:slug` | `{ id, frontmatter, body, html, backlinks }` |
| `GET /api/v1/pages/:category/:slug/links` | `{ id, title, unlinked, related }` |
| `GET /api/v1/pages/:category/:slug/history` | `{ available, reason?, commits }` |
| `GET /api/v1/pages/:category/:slug/diff?rev=` | `{ rev, patch }` |
| `GET /api/v1/search?q=…` | `{ query, results }` (optional `limit`, `category`) |
| `GET /api/v1/graph` | `{ nodes, edges, orphans, deadLinks, totalNodes, totalEdges, orphanCount, deadLinkCount, truncated }` |
| `GET /api/v1/sources` | `{ sources, rawFiles, lock }` |
| `GET /api/v1/watch` | `{ running, startedAt, lastEvent }` |
| `GET /api/v1/integrity` | dead links, orphans, metadata gaps, contradictions |
| `GET /api/v1/config` | provider, model, embeddings status, reranker settings, write mode (no credentials) |
| `GET /api/v1/scout` | Scout queue, listener heartbeat, share URL, and (write mode only) the token |
| `GET /api/v1/events` | SSE `wiki-changed` events |
| `GET /api/v1/jobs` | `{ jobs }` |
| `GET /api/v1/jobs/:id` | `{ job }` |
| `GET /api/v1/jobs/:id/events` | SSE job status, log lines, and streamed deltas |
| `POST /api/v1/actions/:action` | action-specific result or `202 { job }` |
| `DELETE /api/v1/jobs/:id` | cancel a queued/running job |

Actions: `ingest`, `clip`, `query`, `lint`, `context`, `sources/delete`, `sources/reingest`, `embeddings/reindex`, `analysis/save`, `contradiction/resolve`, `watch/start`, `watch/stop`, `page/save`, `page/rename`, `page/merge`, `page/delete`, `page/restore`, `link/insert`, `capture`, `inbox/promote`, `maintain`, `maintain/apply`, `settings/save`, `rerank/setup`, `rerank/test`, `scout/share`, `scout/drain`, `scout/retry`, `scout/remove`, `scout/clear`, `scout/scan`, `preview`. Long-running actions (ingest, clip, query, reindex, agent lint, watched files, scout drains) return a job id; poll the job or subscribe to its SSE stream. `preview` renders Markdown and `context` assembles retrieval evidence; both stay available in read-only mode.

`settings/save` persists reranker changes to the active config (write mode). `rerank/setup` downloads and caches a local model as a job. `rerank/test` scores a few pages with the current settings without writing.

`scout/share` takes `{ url?, text?, tags?, note? }` and queues the hand-off (it does not wait for compilation). `scout/drain` runs the queue as a job. `scout/retry`, `scout/remove`, and `scout/clear` manage items; `scout/scan` picks up files from the drop folder. `--scout` starts the standalone listener inside the serve process on `--scout-port` (default `1719`).

`maintain` returns the deterministic maintenance plan (missing summaries, orphan links, duplicate candidates, dead links, untagged pages) and stays available in read-only mode. `maintain/apply` writes the safe fixes, rebuilds the index and MOC, appends to the log, and commits; it requires write mode. Pass `createStubs: true` to materialise stub pages for dead links and `refreshStale: true` to refresh summaries that no longer share any content words with the body.

`context` takes `{ q }` and returns the evidence block the agent will see: `{ query, sources, estimatedTokens, truncated, text }`. Each source carries `id`, `title`, `summary`, `excerpt`, `sources`, and an `origin` of `search`, `link`, or `backlink` so you can tell matched pages from graph neighbours.

Write mode also enables **watch mode**: `POST /api/v1/actions/watch/start` watches `raw/` and compiles each dropped file as a job. This is the browser equivalent of `axiom-wiki watch` and pairs with the Obsidian Web Clipper.

`/api/v1/pages` is paginated server-side:

| Parameter | Default | Description |
|---|---|---|
| `cat` | — | Exact category filter |
| `q` | — | Case-insensitive match on title, summary, or tags |
| `limit` | `100` | Rows per page (max 500) |
| `cursor` | `0` | Opaque offset returned as `nextCursor` by the previous page |
| `sort` | `category` | `category`, `title`, or `updated` (descending) |

`facets.categories` always contains counts over the whole wiki, so filter chips stay stable while paging.

`/api/v1/graph` returns a bounded slice by default so a large wiki does not emit its entire edge set:

| Parameter | Default | Description |
|---|---|---|
| `limit` | `2000` | Maximum existing nodes (max 10000) |
| `focus` | — | Page id to center a neighborhood on |
| `depth` | `1` | Neighborhood radius when `focus` is set (max 3) |

Without `focus`, the server ranks pages by degree and returns the top slice. `truncated` is `true` when nodes were omitted; `totalNodes`, `totalEdges`, `orphanCount`, and `deadLinkCount` always report the full graph. Dead-link targets referenced by the visible slice are included so broken links remain visible.

The API is GET/HEAD only and returns JSON errors with the appropriate status code. Summary routes use `Cache-Control: no-store`; page payloads use `no-cache` with a weak `ETag` and `Last-Modified`, so a client that revisits a page revalidates with `If-None-Match` and gets a bodyless `304` instead of a re-render.

The page list and graph come from a watcher-backed in-process snapshot: a request after the first is served from memory. Watcher events are coalesced (~150 ms), so a bulk ingest rebuilds the snapshot once after the writes settle rather than once per page.

## Read-only by default

Without `--allow-write`, the server exposes `GET`/`HEAD` routes only. It is safe to keep running locally and to open on your LAN with `--host 0.0.0.0`, but it is not intended for public exposure.

## Write mode (opt-in)

```bash
axiom-wiki serve --allow-write
```

Write mode enables ingest, clip, source deletion/re-ingest, query, analysis filing, contradiction resolution, semantic reindexing, and page authoring (create, edit, rename, merge, delete, restore). It is deliberately narrow:

- It only starts on a loopback host (`127.0.0.1`, `localhost`, or `::1`); `--host 0.0.0.0 --allow-write` is refused.
- Every mutating request needs `X-Axiom-Write: 1`; cross-origin `Origin` headers are rejected (DNS-rebinding guard).
- Web ingest only reads files inside `raw/`. Use the CLI for arbitrary local paths.
- **Mutations acquire the same compilation lock as the CLI.** A busy wiki returns `409` with the holder PID instead of racing.
- **Page writes keep derived artifacts in sync** — `index.md`, `moc.md`, the semantic index, and `state.json` concept mappings are updated, and the changed paths are committed (scoped to those paths) so history stays clean.

To share a wiki publicly, use [Obsidian-compatible](/guides/obsidian/) publishing or a static export.

## Options

| Option | Default | Description |
|---|---|---|
| `-p, --port <port>` | `1717` | Port to listen on |
| `--host <host>` | `127.0.0.1` | Bind address (`0.0.0.0` exposes on the LAN) |
| `--open` | off | Open the browser after starting |
| `--allow-write` | off | Enable mutating actions (loopback only) |

## Developing the frontend

```bash
# Terminal 1 — API + wiki, port 1717
axiom-wiki serve

# Terminal 2 — Vite dev server with HMR, port 1718, proxying /api to 1717
pnpm dev:web
```

Build the frontend with `pnpm build:web` (outputs to `dist/web`) or build both halves with `pnpm build:all`. If `dist/web` is missing when `serve` starts, the server falls back to the legacy server-rendered pages so the command still works from a source checkout.
