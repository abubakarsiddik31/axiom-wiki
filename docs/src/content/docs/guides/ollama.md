---
title: Ollama (Offline)
description: Run Axiom Wiki fully offline with no API key.
---

Run Axiom entirely on-device with no API key using [Ollama](https://ollama.com).

## Setup

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model:

```bash
ollama pull llama3.2
```

3. Run `axiom-wiki init` and select **Ollama (local)**

Axiom connects to `http://localhost:11434` by default and validates the connection during setup.

## Docker + Ollama

```yaml
services:
  axiom-wiki:
    image: axiomwiki/axiom-wiki
    volumes:
      - ./wiki:/app/wiki
      - ./raw:/app/raw
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434/api
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
volumes:
  ollama_data:
```

## Model recommendations

For wiki use, models with strong instruction following and JSON output work best:
- **llama3.2** — good balance of quality and speed
- **mistral** — fast, good for smaller documents
- **qwen2.5** — strong multilingual support
