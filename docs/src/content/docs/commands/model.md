---
title: model
description: Switch LLM provider or model.
---

```bash
axiom-wiki model
```

Interactive screen to switch your LLM provider or model. Changes take effect immediately for all subsequent operations.

### Options

- **Change provider + model** — switch to a different LLM provider (Google, OpenAI, Anthropic, Ollama) and pick a new model
- **Change model only** — keep the current provider, pick a different model
- **Update API key** — update your API key without changing the model

### Ollama

When using Ollama, the model screen shows your **locally installed models** fetched from the Ollama server. If no models are found, you can select a suggested model to pull it automatically, or enter a custom model name.
