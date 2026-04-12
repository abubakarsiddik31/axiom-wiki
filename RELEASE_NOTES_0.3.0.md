# Axiom Wiki v0.3.0

**Autonomous autowiki — the agent explores, decides, and builds.**

---

## Highlights

### Agent-Driven Autowiki

The `autowiki` command has been completely rebuilt. Instead of a rigid plan-then-execute pipeline (LLM outputs JSON plan → parse → execute one page at a time), the agent now has tools to freely explore your project and decide what to document.

The agent:
1. Surveys the project structure using `get_project_overview`
2. Reads key files on demand using `read_project_file`
3. Searches code with `search_project`
4. Decides what wiki pages to create — no pre-planned JSON array
5. Writes pages, checks the wiki index, explores more, writes more

No fallback plans. No regex-parsed JSON. The agent figures it out.

### Batched Execution

Large projects are processed in multiple batches. Each batch is a fresh agent session with a clean context window. Between batches, the wiki carries state — the agent reads `wiki/index.md` to see what it's already documented, then focuses on uncovered areas.

This means:
- **Crash recovery** — if batch 3 fails, pages from batches 1 and 2 are preserved
- **Cost control** — cost is tracked per batch with a configurable ceiling (default $5)
- **No context degradation** — batch 5 has the same quality as batch 1
- **Scales to large projects** — small projects need 1-2 batches, large ones scale to 8+

### Works Beyond Code

Autowiki now auto-detects whether you're pointing it at a codebase or a folder of documents. The agent adapts its approach:

- **Code folders** (`.ts`, `.py`, `.go`, etc.) — documents architecture, modules, patterns, design decisions
- **Document folders** (`.md`, `.pdf`, `.docx`, etc.) — extracts entities (people, orgs), concepts (ideas, themes), and creates synthesis pages that connect knowledge across documents

Use it on company docs, research papers, personal notes, meeting transcripts — not just code.

### Codebase Exploration Tools

Four new tools available to the agent during autowiki and sync:

| Tool | Purpose |
|------|---------|
| `get_project_overview` | Directory tree, key files, language stats |
| `read_project_file` | Read any project file on demand |
| `list_project_dir` | List directory contents with sizes |
| `search_project` | Grep across the project |

The agent reads files on demand instead of having content dumped into the prompt — it skips irrelevant files and focuses on what matters.

### Simpler Sync

The `sync` command uses the same agent-driven approach. It reads existing wiki pages, checks changed files via `git diff`, and decides what needs updating. No more rigid path-to-page mapping.

### Robustness Overhaul

Delivered alongside the autowiki rewrite:

- **Exponential backoff retry** — all LLM calls wrapped with `withRetry()`, smart error classification (only retries transient errors like 429, 503, ECONNRESET)
- **Pre-flight checks** — file size and context budget validation before calling the LLM
- **Friendly error messages** — context limits, auth failures, billing issues get actionable advice
- **Context-aware content gathering** — autowiki calculates available token budget per call

---

## All Changes

### New Features
- **Agent-driven autowiki** — autonomous exploration and wiki generation in batches
- **Codebase tools** — `read_project_file`, `list_project_dir`, `search_project`, `get_project_overview`
- **Content type detection** — auto-adapts prompts for code vs document folders
- **Batched execution** — crash recovery, cost control, context-fresh batches
- **Exponential backoff** — resilient LLM calls with smart retry logic
- **Error classification** — distinguishes auth, billing, context limit, transient, and unknown errors

### Improvements
- Autowiki no longer requires a rigid JSON plan step — agent decides freely
- Sync uses agent-driven exploration instead of fixed path-to-page mapping
- Pre-flight file size and context budget checks before LLM calls
- Friendly error messages with actionable tips (switch model, check API key, etc.)
- All 8 screens wrapped with `withRetry` for resilient LLM calls
- Context-aware content gathering respects model context window size

### Breaking Changes
- The autowiki confirmation screen no longer shows a page-by-page plan (the agent decides during execution)
- `map-state.json` `paths` field per page may be empty (agent discovers associations dynamically)

### New Files
- `src/agent/codebase-tools.ts` — project exploration tools for the agent
- `src/core/autowiki.ts` — `runAutowiki()` and `runSync()` batch orchestrators
- `src/core/retry.ts` — exponential backoff with error classification

### Documentation
- Updated autowiki command docs for agent-driven approach
- Updated sync command docs
- Updated codebase mapping guide with batched execution details
- Updated quick-start guide
- Updated README — "works beyond code" messaging

---

## Migration from 0.2.x

**No manual steps required.** Existing wikis work as-is:
- `map-state.json` is forward-compatible
- Running `autowiki` again creates fresh pages using the new agent-driven approach
- `sync` will work with existing map state — it uses `git diff` the same way
- The `map` alias still works

---

## Stats

- 21 files changed
- +1,439 lines / -720 lines
- 76 tests passing
