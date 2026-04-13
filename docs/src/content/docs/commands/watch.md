---
title: watch
description: Auto-ingest new files dropped into raw/.
---

```bash
axiom-wiki watch
```

Watches the `raw/` folder and automatically ingests files as they appear. Respects `.axiomignore` patterns and shows cost per file.

Files are tracked by SHA-256 hash — unchanged files are skipped automatically, and modified files are re-ingested. A compilation lock prevents concurrent ingests when multiple files arrive at once. The index and Map of Content (`moc.md`) are rebuilt after each file.

Press `q` to stop watching.
