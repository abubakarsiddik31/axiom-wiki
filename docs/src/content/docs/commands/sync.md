---
title: sync
description: Update wiki pages for recent changes.
---

```bash
axiom-wiki sync
```

Detects what changed since the last `autowiki` or `sync`, and lets the agent update stale pages and document new areas.

## Prerequisites

Run [`autowiki`](/axiom-wiki/commands/map/) first. Sync reads the map state (`.axiom/map-state.json`) to know what was previously documented.

## How it works

1. Uses `git diff` to find changed files since the last sync
2. Shows which directories have changes and how many files
3. The agent reads existing wiki pages and the changed files
4. Updates pages that are stale, creates pages for new areas
5. Only rewrites pages where content has actually changed
6. Rebuilds the index and Map of Content (`moc.md`)

The agent has the same tools as autowiki — it can read any project file, search code, and navigate the wiki to decide what needs updating.

## What gets detected

- **Changed files** — any file modified, added, or deleted since the last sync
- **New areas** — the agent may create new pages if significant new content appeared

For non-git projects, sync treats all files as changed (equivalent to a full re-run).

See the [Codebase Mapping guide](/axiom-wiki/guides/mapping/) for the full workflow.
