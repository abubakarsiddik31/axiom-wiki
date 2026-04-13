---
title: Ollama (Offline)
description: Run Axiom Wiki fully offline with no API key.
---

Run Axiom entirely on-device with no API key using [Ollama](https://ollama.com).

### Setup

1. Install Ollama from [ollama.com](https://ollama.com)
2. Start the server: `ollama serve`
3. Run `axiom-wiki init` and select **Ollama (local)**

During setup, Axiom connects to Ollama, detects your locally pulled models, and lets you pick one. If you haven't pulled any models yet, select one from the suggestions and Axiom will pull it for you automatically.

### Model selection

The init wizard and model screen show models that are **actually installed** on your machine. You'll see each model with its parameter size (e.g., `qwen3.5:4b (4.7B)`).

If no models are pulled, Axiom shows recommended options. Select one to auto-pull it with streaming progress — no need to open a separate terminal.

You can also enter any custom model name. If it's not available locally, Axiom pulls it before proceeding.

### Context window

Ollama defaults to a small context window (4096 tokens) which is too small for most wiki ingestion tasks. Axiom overrides this to **65,536 tokens** by default.

To customize the context window, add `ollamaNumCtx` to your config:

```json
{
  "provider": "ollama",
  "model": "qwen3.5:4b",
  "ollamaNumCtx": 32768
}
```

Ollama will automatically cap to the model's maximum if you request more than it supports.

### Docker + Ollama

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./wiki:/app/wiki
      - ./raw:/app/raw
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
volumes:
  ollama_data:
```

### Model recommendations

For wiki use, models with strong instruction following and tool calling work best:

- **qwen2.5 (7B)** — strong reasoning, multilingual, good tool calling
- **llama3.2 (3B)** — fast and lightweight, good for smaller documents
- **llama3.1 (8B)** — strong general-purpose, larger context
- **mistral (7B)** — fast, good instruction following

### Debugging

Set `AXIOM_DEBUG=1` to see detailed logs for Ollama requests:

```bash
AXIOM_DEBUG=1 axiom-wiki ingest 2>/tmp/axiom-debug.log
```

This shows the model being loaded, context window size, token counts, and tool call round-trips.
