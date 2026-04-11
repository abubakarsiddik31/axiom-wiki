---
title: sync
description: Update wiki pages for recent codebase changes.
---

```bash
axiom-wiki sync
```

Detects what changed in the codebase since the last `map` or `sync`, and re-generates only the affected wiki pages.

## Prerequisites

Run [`map`](/axiom-wiki/commands/map/) first. Sync reads the map state (`.axiom/map-state.json`) to know which pages cover which source paths.

## How it works

1. Uses `git diff` to find changed files since the last sync
2. Matches changed files to wiki pages via stored path mappings
3. Shows which pages need updating with a cost estimate
4. Re-generates only the affected pages
5. Always refreshes the overview page

## What gets detected

- **Changed files** — any file modified, added, or deleted since the last sync
- **Stale pages** — wiki pages whose source directories no longer exist
- **Uncovered directories** — new directories not covered by any wiki page

For non-git projects, sync treats all files as changed (equivalent to a full re-map).

See the [Codebase Mapping guide](/axiom-wiki/guides/mapping/) for the full workflow.
