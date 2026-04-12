---
title: clip
description: Clip a URL and save it to raw/ for ingest.
---

:::tip
You can also use `axiom-wiki ingest <url>` to clip and ingest a URL in one step.
:::

```bash
axiom-wiki clip [url]
```

Fetches a URL, extracts the article content via Readability (the same engine Firefox Reader Mode uses), converts it to Markdown with frontmatter, and saves it to `raw/`.

You are then prompted to ingest immediately or save for later. Ingested clips are tracked in `.axiom/state.json` like any other source, so they participate in incremental compilation.

## Supported content types

- **HTML articles** — Readability extraction, converted to Markdown with `source_url` frontmatter
- **PDF URLs** — direct download
- **Image URLs** — direct download (`.png`, `.jpg`, `.webp`)
