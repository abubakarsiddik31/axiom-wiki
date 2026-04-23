# Axiom Wiki v0.7.0

**Hybrid Semantic Search — Conceptual understanding for your AI agent.**

---

## Highlights

### Hybrid Semantic Search (Lexical + Vector)

Axiom Wiki now features a high-performance, local-first **Hybrid Search** engine powered by **Orama**. This transforms the wiki from a keyword-indexed document store into a true knowledge engine that understands conceptual intent.

- **Lexical Search**: Traditional keyword matching for exact terms, function names, and technical identifiers.
- **Vector Search**: Semantic matching for conceptual queries (e.g., searching for "user identity" finds "authentication logic").
- **Reciprocal Rank Fusion (RRF)**: Automatically merges results from both engines to provide the most relevant context.

### Multi-Provider Embedding Support

Choose the embedding provider that fits your privacy and performance needs:

- **Google Gemini** (Recommended): High performance, generous free tier. Uses `text-embedding-004`.
- **OpenAI**: Industry standard reliability. Uses `text-embedding-3-small`.
- **Ollama**: 100% local and private. Uses `nomic-embed-text`.

### Automated Maintenance & Health

The semantic index stays current automatically as your wiki evolves:
- **Auto-Indexing**: Every time a page is created or updated via `autowiki`, `sync`, or `ingest`, its vector is updated.
- **Real-time MCP Updates**: The `notify_code_change` tool now triggers background vector updates for modified pages.
- **Health Tracking**: New `semanticHealth` metrics in `get_wiki_health` and the `status` screen track index freshness and provider status.

---

## All Changes

### New Features
- **Orama Search Engine** — Pure-JS, hybrid-native, zero-dependency search core.
- **Multi-provider embedding layer** — Support for Google, OpenAI, and Ollama.
- **`axiom-wiki embed` command** — Interactive setup (`--setup`), status (`--status`), and re-indexing (`--reindex`).
- **Hybrid query logic** — Automatic RRF merging in `searchWiki`.
- **Dimension mismatch detection** — Robust index recovery when switching embedding models.
- **Semantic health tracking** — Integrated into CLI status and MCP health tools.

### Improvements
- **Sync integration** — Full support for vector indexing in Tier 2 incremental sync.
- **MCP Tool upgrade** — `plan_with_wiki` and `search_wiki` now use hybrid search by default.
- **Init Flow** — Interactive semantic search setup during first-time initialization.
- **CLI Tips** — Non-intrusive nudges to enable semantic search for better agent planning.

### Documentation
- **New Guide**: `docs/src/content/docs/guides/v070-migration.md`
- **New Command Reference**: `docs/src/content/docs/commands/embed.md`
- **Updated Guides**: `init.md`, `wiki-structure.md`, and `README.md` updated with semantic search details.

---

## Migration from v0.6.x

**Existing wikis work without modification.** To enable semantic capabilities:

1. Run `axiom-wiki embed --setup`.
2. Pick your embedding provider and model.
3. The wizard will automatically perform the initial full-index of your wiki.

Once set up, your AI agents will immediately benefit from 10x better context retrieval.

---

## Stats

- 15+ files changed
- Integrated Orama v3
- Added `ai` dependency for standardized model interaction
- Full build verification completed
