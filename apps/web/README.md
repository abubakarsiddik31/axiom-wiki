# @axiom-wiki/web

The Axiom Wiki frontend: Vite + React + TypeScript + Tailwind, styled to the
design system in the repo root `DESIGN.md`.

It is a read-only client of the JSON API served by `axiom-wiki serve`
(`/api/v1/overview`, `/pages`, `/pages/:category/:slug`, `/search`, `/graph`).

## Development

```bash
# Terminal 1 — the wiki + API (from the repo root)
pnpm build
node dist/bin/axiom-wiki.js serve
# or, from an installed CLI: axiom-wiki serve

# Terminal 2 — Vite with HMR on :1718
pnpm dev:web
```

Vite proxies `/api` and `/healthz` to `http://127.0.0.1:1717`.

## Build

```bash
pnpm build:web      # from the repo root
```

Output goes to the CLI package's `dist/web` so `axiom-wiki serve` can ship it in
the npm package. `pnpm build:all` builds the CLI and the frontend together.

## Routes

| Route | Page |
|---|---|
| `/` | Overview: stats, categories, recent pages |
| `/pages` | Page library with category and text filters (`?cat=`, `?q=`) |
| `/page/:category/:slug` | Rendered wiki page with tags, sources, and backlinks |
| `/search?q=` | Hybrid search with section badges and highlighted snippets |
| `/graph` | Interactive link graph (zoom, pan, click nodes) |
