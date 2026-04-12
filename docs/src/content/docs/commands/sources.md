---
title: sources
description: Browse and manage ingested sources.
---

```bash
axiom-wiki sources
```

Interactive browser for all ingested sources. Navigate with arrow keys:

| Key | Action |
|-----|--------|
| `v` | View the source's wiki summary page |
| `r` | Mark for re-ingest (clears the source hash so the next `ingest` picks it up as changed) |
| `d` | Delete the source summary page and remove it from compilation state |
| `q` | Quit |
