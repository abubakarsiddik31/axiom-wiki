---
title: Rerankers
description: Candidate reranking for Ask and query, and the four supported backends.
---

Hybrid search is good at recall: it finds plenty of pages that might matter. A reranker is good at precision: it reads each `(query, page)` pair and decides which ones actually answer the question.

Axiom over-fetches candidates, reranks them, and keeps the best few before the link graph expands the evidence block.

## Providers

| Provider | Model | Default | Install | Where the text goes |
|---|---|---|---|---|
| `local` | `Xenova/bge-reranker-base` | **yes** | ONNX runtime + 266 MB model download | stays on the machine |
| `local` (`fast`) | `Xenova/ms-marco-MiniLM-L-6-v2` | — | 23 MB model | stays on the machine |
| `local` (`multilingual`) | `onnx-community/bge-reranker-v2-m3-ONNX` | — | 571 MB model | stays on the machine |
| `llm` | your configured chat model | — | none | same provider Ask already uses |
| `cohere` | `rerank-v3.5` | — | Cohere API key | Cohere |
| `none` | — | — | — | — |

The default is the **balanced local** cross-encoder: 266 MB quantized, English, no API key, no per-query cost. It is downloaded on demand and cached under `~/.axiom/models` (override with `AXIOM_MODELS_DIR`).

## Retrieval flow

```
question
  → hybrid search (BM25 + vectors) over-fetches 24 candidates
  → reranker rescores each candidate
  → keep the top 6
  → one-hop graph expansion (outbound links + backlinks)
  → citable evidence block
```

`candidates` and `top-n` are configurable. More candidates improve recall before the reranker; more kept seeds give the model more evidence but cost context.

## Configuring

In the web app: **Settings → Reranker**. In the CLI:

```bash
axiom-wiki rerank --provider local --model balanced
axiom-wiki rerank --setup
```

The config is stored as:

```json
{
  "rerank": {
    "provider": "local",
    "model": "Xenova/bge-reranker-base",
    "topN": 6,
    "candidates": 24
  }
}
```

For Cohere, add `apiKey` or set `COHERE_API_KEY`. The key is never returned by the API; the Settings page only reports whether one is saved.

## Fallbacks and failure modes

Reranking never blocks an answer:

- Local model not downloaded → hybrid order, with a reason in the Ask preview.
- Cohere key missing or request failed → hybrid order, with the error in the preview.
- Chat model rerank call failed → hybrid order.
- `provider: "none"` → hybrid order, no extra work.

The Ask page shows a small badge next to **grounded in N pages**: `reranked · local`, `hybrid order`, or `reranker off`.

## Install footprint

The local backend uses Transformers.js and ONNX Runtime. That adds a native runtime to `node_modules` (roughly 300 MB unpacked) so the CLI can run the model without a Python sidecar. If you do not want that footprint, use `llm` or `cohere`, or set `none`.

Models are downloaded lazily and are not part of the npm package. `axiom-wiki rerank --status` shows which presets are cached.
