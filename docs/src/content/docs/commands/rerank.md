---
title: rerank
description: Configure, download, or test the candidate reranker.
---

```bash
axiom-wiki rerank --status
axiom-wiki rerank --setup
axiom-wiki rerank --test "what is the halting problem?"
```

`rerank` is the CLI for the retrieval reranker. The same settings are available in the web app under **Settings → Reranker**.

## Options

| Option | Description |
|---|---|
| `--status` | Show the effective provider, model, candidate limits, and local model cache status |
| `--setup` | Download and cache the configured local model |
| `--test <query>` | Rerank the first few pages for a query and print the scores |
| `--provider <provider>` | `local`, `llm`, `cohere`, or `none` |
| `--model <model>` | Local model id or preset key (`fast`, `balanced`, `multilingual`); Cohere model id |
| `--top-n <n>` | Seeds kept after reranking (default `6`) |
| `--candidates <n>` | Candidates pulled from hybrid search before reranking (default `24`) |
| `--api-key <key>` | Cohere API key |
| `--clear-api-key` | Remove the stored Cohere key |
| `--json` | Print the result as JSON |

## Examples

```bash
# The default: local balanced cross-encoder
axiom-wiki rerank --provider local --model balanced

# Fast local model (23 MB, English)
axiom-wiki rerank --provider local --model fast

# Multilingual local model (571 MB)
axiom-wiki rerank --provider local --model multilingual

# Use the chat model you already configured (no download)
axiom-wiki rerank --provider llm

# Hosted Cohere Rerank
axiom-wiki rerank --provider cohere --model rerank-v3.5 --api-key "$COHERE_API_KEY"

# Turn reranking off
axiom-wiki rerank --provider none

# Download the selected local model once
axiom-wiki rerank --setup

# See the effect without changing the wiki
axiom-wiki rerank --test "why does the halting problem matter?"
```

## Fallbacks

Reranking is a precision pass, not a hard dependency. If a local model is not downloaded, if the Cohere key is missing, or if the provider call fails, retrieval falls back to the hybrid order and the Ask page reports the reason. `--setup` or the Settings page makes the local model active.

See [Rerankers](/reference/rerankers) for the model table, the retrieval flow, and the privacy trade-offs.
