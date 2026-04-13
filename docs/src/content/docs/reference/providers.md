---
title: LLM Providers
description: Supported LLM providers and models.
---

| Provider | Models | Free Tier | Get API Key |
|---|---|---|---|
| **Google Gemini** *(recommended)* | Gemini 3 Flash, 3.1 Pro, 3.1 Flash Lite, 2.5 Pro, 2.0 Flash, Gemma 4 | Yes | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano | No | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | No | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Ollama** *(local)* | Any model you pull locally | Free | [ollama.com](https://ollama.com) |

Switch provider or model at any time:

```bash
axiom-wiki model
```

Google Gemini is recommended because it has a generous free tier and strong performance for wiki tasks.

### Ollama

Ollama runs models locally with no API key. During setup, Axiom detects your installed models and lets you pick one. If no models are pulled, you can select a suggested model and Axiom pulls it automatically.

The default context window for Ollama is 65,536 tokens. Override it with `ollamaNumCtx` in your config. See the [Ollama guide](/axiom-wiki/guides/ollama/) for details.
