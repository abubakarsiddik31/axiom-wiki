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

When enabled, Axiom indexes your wiki pages in a local **Orama** hybrid index (`search.index`) and tracks metadata in `search.manifest.json`:

1. **Markdown Section Chunking**: Large documents are automatically split along markdown headings (`##`, `###`) into section chunks with hierarchical context (`[Document > Section]`). This prevents token truncation on long documents and provides precise section-level search results without result crowding.
2. **Dynamic Dimension Probing**: Axiom automatically inspects and probes the exact vector dimensions of your chosen model (e.g. 768d, 1024d, 1536d, 3072d), eliminating hardcoded assumptions.
3. **Consistency Verification**: An index manifest (`wiki/search.manifest.json`) locks the active embedding configuration `(provider, model, dimensions)`. If you change your model, Axiom prevents vector pollution and warns you to re-index.
4. **Batch Indexing**: Reindexing processes pages in batches of up to 50 chunks with provider-aware rate pacing (e.g. respecting Google's 15 RPM limit).
5. **Reciprocal Rank Fusion (RRF)**: Search queries run both semantic vector similarity and BM25 full-text keyword matching, deduplicating hits by document while preserving section anchors.

### Migration for Existing Users

If you already have an Axiom Wiki but haven't enabled semantic search:

1.  **Upgrade**: Ensure you are on `axiom-wiki@0.7.0` or higher.
2.  **Setup**: Run `axiom-wiki embed --setup`.
3.  **Index**: The wizard will guide you through picking a provider and will automatically trigger a full re-index of your existing pages.

Once complete, your AI agent will automatically start using hybrid search for all planning and context retrieval tasks.

### Indexing Maintenance

Indexing happens automatically during:
- `axiom-wiki ingest`
- `axiom-wiki autowiki`
- `axiom-wiki sync`
- Real-time updates via MCP `notify_code_change`
