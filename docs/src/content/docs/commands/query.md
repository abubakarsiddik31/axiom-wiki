---
title: query
description: Interactive chat against your wiki.
---

```bash
axiom-wiki query
```

Opens an interactive chat where you can ask questions about your wiki content. The agent searches relevant pages, synthesizes an answer, and cites sources.

You can also type questions directly in the interactive shell without the `/query` prefix:

```
> What did Alan Turing say about intelligence?
```

After answering, the agent offers to file the answer as an analysis page in `wiki/pages/analyses/`.

## Analyses-first search

The agent checks `wiki/pages/analyses/` first to see if the question has already been answered. Previously filed analysis pages receive a 1.5x boost in search ranking, so they surface ahead of raw entity or concept pages. This means repeat questions are answered faster and more consistently.

## Structural tree search

For large wikis with thousands of pages, the query agent avoids dumping the entire catalog into context. Instead, it navigates structurally:
- Inspects high-level category and tag trees using `list_pages({ mode: "tree" })`.
- Runs targeted hybrid searches with section-level anchor resolution.
- Explores graph connections and backlinks (`get_backlinks`) to trace relationships between concepts and entities.
