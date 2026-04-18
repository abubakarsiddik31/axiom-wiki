# Axiom Wiki v0.6.0

**8 LLM providers, MCP resources, and agent-optimized output formats.**

---

## Highlights

### Multi-Provider Expansion (4 → 8 providers)

Axiom Wiki now supports 8 LLM providers out of the box:

| Provider | Highlights |
|----------|-----------|
| **Google Gemini** *(recommended)* | Free tier, 1M context |
| **OpenAI** | GPT-5.4 family |
| **Anthropic** | Claude Opus/Sonnet/Haiku |
| **OpenRouter** | 300+ models, single API key, dynamic model fetching |
| **DeepSeek** | V3 (cheap general-purpose) + R1 (chain-of-thought reasoning) |
| **Groq** | Ultra-fast inference, generous free tier |
| **Mistral AI** | Large, Medium, Small, Codestral (code-specialized, 256K context) |
| **Ollama** | Local/offline, any model you pull |

DeepSeek, Groq, and Mistral all use the OpenAI-compatible API format. A new `createOpenAICompatible()` helper means adding future providers is ~5 lines of code.

### MCP Resources — Ambient Context for Agents

Agents that support MCP resources (like Claude Code) can now pin wiki data as always-on context without explicit tool calls:

| Resource | Description |
|----------|-------------|
| `axiom://overview` | Project architecture overview — pin this for every conversation |
| `axiom://index` | Full page index with summaries and staleness markers (`[STALE]`, `[~]`) |
| `axiom://recent-changes` | Last 10 wiki log entries |

### Compact Output Format — 80–95% Token Savings

Planning tools (`get_architecture_brief`, `plan_with_wiki`, `get_context_for_change`) now accept a `format` parameter:

- `"full"` (default) — complete markdown
- `"compact"` — frontmatter + first paragraph + cross-references (~80% token reduction)
- `"summary"` — title + summary + tags only (~95% token reduction)

Combined with the new `maxTokens` parameter, agents can request exactly the amount of context they need without blowing their context window.

### New MCP Planning Tools

Three tools previously only available inside the agent are now exposed via MCP:

| Tool | Purpose |
|------|---------|
| `notify_code_change` | Report code changes → Tier 1 (free) + optional Tier 2 (LLM) updates |
| `report_task_complete` | End-of-task staleness report with git diff detection |
| `get_wiki_health` | Wiki health dashboard: staleness scores, sync status, health rating, recommendations |

`get_wiki_health` is new — it returns an overall health rating (`excellent`/`good`/`fair`/`poor`), average confidence score, count of stale pages, whether the wiki is behind HEAD, and the 5 stalest pages.

---

## All Changes

### New Features
- **DeepSeek provider** — V3 (chat) and R1 (reasoner) models via OpenAI-compatible API
- **Groq provider** — Llama 3.3 70B, Gemma 2 9B, Llama 3.1 8B with ultra-fast inference
- **Mistral AI provider** — Large, Medium, Small, and Codestral models
- **OpenRouter provider** — 300+ models with dynamic model fetching during setup
- **MCP resources** — `axiom://overview`, `axiom://index`, `axiom://recent-changes`
- **`get_wiki_health` tool** — comprehensive wiki health status via MCP
- **`notify_code_change` via MCP** — previously only available as an agent tool
- **`report_task_complete` via MCP** — previously only available as an agent tool
- **Compact/summary output format** — `format` parameter on planning tools for token-efficient responses
- **Token budget** — `maxTokens` parameter on planning tools, content auto-truncates to fit

### Infrastructure
- `createOpenAICompatible()` helper extracted in `src/agent/index.ts` — shared by OpenRouter, DeepSeek, Groq, Mistral
- `AxiomConfig.provider` union type expanded to include all 8 providers
- MCP server declares `resources` capability alongside existing `logging`
- `package.json` keywords updated for discoverability

### Documentation
- README provider table expanded (4 → 8 providers)
- Quick-start guide updated with all provider names
- Providers reference page: added DeepSeek, Groq, Mistral sections with descriptions
- MCP guide: added Resources section, format options, `get_wiki_health` tool

---

## Migration from 0.5.x

**No breaking changes.** Existing wikis and configs work without modification.

- To use a new provider: run `axiom-wiki model` and select it from the list
- MCP resources are available immediately — no configuration needed
- To use compact format: pass `format: "compact"` to planning tool calls
- Existing MCP clients will see the new tools and resources after restarting

---

## Stats

- 10 files changed
- +704 lines / -22 lines
- 3 commits since v0.5.1
