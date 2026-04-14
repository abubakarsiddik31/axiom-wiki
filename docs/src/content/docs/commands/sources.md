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

## Frozen concepts

When you delete a source with `d`, Axiom checks if any of its wiki pages are shared with other sources. Shared pages are **frozen** — they stay in the wiki and are recorded in `state.json` under `frozenSlugs`. Only pages unique to the deleted source are reported as orphaned.

For example, if `paper-a.pdf` and `paper-b.pdf` both contributed to the "gradient descent" concept page, deleting `paper-a.pdf` preserves that page because `paper-b.pdf` still contributes to it. The status message shows how many pages were preserved:

```
Removed paper-a.pdf (2 shared pages preserved)
```
