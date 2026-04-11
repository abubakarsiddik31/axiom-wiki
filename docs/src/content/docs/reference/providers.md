---
title: LLM Providers
description: Supported LLM providers and models.
---

| Provider | Models | Free Tier | Get API Key |
|---|---|---|---|
| **Google Gemini** *(recommended)* | Gemini 3 Flash, 3.1 Pro, 3.1 Flash Lite, 2.5 Pro, 2.0 Flash, Gemma 4 | Yes | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano | No | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | No | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Ollama** *(local)* | Llama 3.2, Mistral, Qwen 2.5 | Free | [ollama.com](https://ollama.com) |

Switch provider or model at any time:

```bash
axiom-wiki model
```

Google Gemini is recommended because it has a generous free tier and strong performance for wiki tasks.
