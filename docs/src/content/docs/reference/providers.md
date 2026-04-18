---
title: LLM Providers
description: Supported LLM providers and models.
---

| Provider | Models | Free Tier | Get API Key |
|---|---|---|---|
| **Google Gemini** *(recommended)* | Gemini 3 Flash, 3.1 Pro, 3.1 Flash Lite, 2.5 Pro, 2.0 Flash, Gemma 4 | Yes | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano | No | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | No | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenRouter** | 300+ models (Claude, GPT, Llama, DeepSeek, etc.) | Yes (free models available) | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **DeepSeek** | DeepSeek V3 (chat), DeepSeek R1 (reasoning) | No | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| **Groq** | Llama 3.3 70B, Gemma 2 9B, Llama 3.1 8B | Yes (generous free tier) | [console.groq.com](https://console.groq.com/keys) |
| **Mistral AI** | Mistral Large, Medium, Small, Codestral | No | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| **Ollama** *(local)* | Any model you pull locally | Free | [ollama.com](https://ollama.com) |

Switch provider or model at any time:

```bash
axiom-wiki model
```

Google Gemini is recommended because it has a generous free tier and strong performance for wiki tasks.

### OpenRouter

OpenRouter is a unified API that gives you access to 300+ models from every major provider (Anthropic, OpenAI, Google, Meta, DeepSeek, Mistral, and more) through a single API key.

Use it when you want to:
- Access models from multiple providers without managing separate API keys
- Use free models (Llama 3.3 70B, DeepSeek R1, and others)
- Use the **Auto** router that picks the best model for each prompt automatically
- Try new models without switching providers

The setup is the same as any other provider — just paste your OpenRouter API key during `axiom-wiki init`.

### DeepSeek

DeepSeek offers two models: **V3** for general-purpose tasks (fast, very affordable) and **R1** for chain-of-thought reasoning. Both use the OpenAI-compatible API format.

### Groq

Groq provides extremely fast inference on open-source models. Great for interactive query mode where speed matters. Has a generous free tier.

### Mistral AI

Mistral offers a range of models from the fast and cheap **Small** to the powerful **Large**. **Codestral** is a code-specialized model with a 256K context window — excellent for autowiki on large codebases.

### Ollama

Ollama runs models locally with no API key. During setup, Axiom detects your installed models and lets you pick one. If no models are pulled, you can select a suggested model and Axiom pulls it automatically.

The default context window for Ollama is 65,536 tokens. Override it with `ollamaNumCtx` in your config. See the [Ollama guide](/axiom-wiki/guides/ollama/) for details.
