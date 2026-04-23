---
title: embed
description: Manage semantic search embeddings.
---

```bash
axiom-wiki embed [options]
```

Axiom Wiki supports **Hybrid Search**, combining traditional keyword matching with modern vector embeddings. This allows the AI agent to find relevant context even if the exact keywords don't match.

### Options

| Option | Description |
|---|---|
| `--setup` | Launch the interactive setup wizard to pick a provider and model. |
| `--reindex` | Force a full re-index of all wiki pages. |
| `--status` | Show the current embedding configuration and index size. |

### Providers

Axiom supports three embedding providers:

1.  **Google Gemini** (Recommended): High performance, generous free tier. Uses `text-embedding-004`.
2.  **OpenAI**: Industry standard. Uses `text-embedding-3-small`.
3.  **Ollama**: Total privacy, local-first. Uses `nomic-embed-text`.

### How it works

When enabled, Axiom generates a vector embedding for every wiki page and stores them in a local **Orama** index (`search.index`). 

Search queries are automatically converted to vectors, and the results are merged with keyword matches using **Reciprocal Rank Fusion (RRF)**. This ensures that exact matches still rank highly while semantically related pages are surfaced.

Indexing happens automatically during:
- `axiom-wiki ingest`
- `axiom-wiki autowiki`
- `axiom-wiki sync`
- Real-time updates via MCP `notify_code_change`
