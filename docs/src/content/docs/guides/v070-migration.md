---
title: Upgrading to v0.7.0
description: How to enable Semantic Search and upgrade your existing Axiom Wiki.
---

Axiom Wiki v0.7.0 introduces **Hybrid Semantic Search** (Lexical + Vector) using the Orama engine. This upgrade allows your AI agents to find relevant context through conceptual understanding rather than just keyword matching.

:::note
This guide applies to all v0.7.x releases (v0.7.0, v0.7.1, v0.7.2).
:::

## 🔄 Upgrade Steps (v0.6.0 → v0.7.0)

If you are an existing user upgrading from v0.6.0 to v0.7.0, follow these steps to enable the new semantic capabilities:

### 1. Configure Embeddings
Run the new interactive setup wizard:
```bash
axiom-wiki embed --setup
```

### 2. Pick a Provider
Choose the embedding provider that best fits your workflow:
- **Google Gemini** (Recommended): High performance, generous free tier. Uses `text-embedding-004`.
- **OpenAI**: Industry standard. Uses `text-embedding-3-small`.
- **Ollama**: 100% local and private. Uses `nomic-embed-text`.

### 3. Build Initial Index
The wizard will automatically trigger a full re-index of your existing pages. This process:
1. Generates vector embeddings for every page in your wiki.
2. Stores them in a new local index file: `axiom/wiki/search.index`.
3. Marks all pages as "vector synced" in your state management.

## 🚀 What's New in v0.7.0?

### Hybrid Search (Keyword + Vector)
Axiom now uses **Reciprocal Rank Fusion (RRF)** to merge results from two different search engines:
- **Lexical Search**: Traditional keyword matching for exact terms and technical identifiers.
- **Vector Search**: Semantic matching for conceptual queries and intent.

### Agent Intelligence Boost
Tools like `plan_with_wiki` and `search_wiki` are now "semantic-aware." Agents can now find relevant documentation even if they use different terminology than what is written in your markdown files.

### Real-time Maintenance
The semantic index is kept fresh automatically. Every time you (or your agent) modify a page via `autowiki`, `sync`, or the MCP `notify_code_change` tool, the vector embedding is updated in the background.

## 🛠 Troubleshooting

### Dimension Mismatch
If you switch embedding providers (e.g., from OpenAI to Ollama), the index will detect a dimension mismatch. Simply run:
```bash
axiom-wiki embed --reindex
```

### Checking Status
You can check the health of your semantic index at any time:
```bash
axiom-wiki status
# OR
axiom-wiki embed --status
```
