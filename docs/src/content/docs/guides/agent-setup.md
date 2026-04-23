---
title: Agent Setup
description: Configure AI coding agents to automatically maintain the axiom-wiki as you code.
---

Axiom Wiki can stay up to date automatically when you work with AI coding agents. The agent calls MCP tools to report changes, log decisions, and query the wiki for planning context.

## Quick Setup

Run the interactive setup command:

```bash
axiom-wiki setup-agent
```

This detects your agent config files and appends the axiom-wiki instructions. Supported agents:

| Agent | Config File |
|-------|------------|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex | `AGENTS.md` |
| Cursor | `.cursorrules` |
| Windsurf | `.windsurfrules` |
| Google Gemini | `GEMINI.md` |

## Cost Rule: Batch Code Updates Aggressively

`notify_code_change` with `run_tier2: true` costs LLM tokens (~2-5K per wiki page updated). The agent is instructed to call it **at most once per feature or PR** — whichever comes first. Never per-file or per-edit.

Everything else is free — decisions, planning queries, status checks. Those can be called as often as needed.

## When Does the Agent Trigger Updates?

### 1. Decisions → Log immediately (FREE)

```
log_decision({
  decision: "Chose JWT over session cookies for auth",
  context: "Need stateless auth for horizontal scaling",
  alternatives: ["Session cookies", "OAuth tokens"],
  affected_areas: ["auth", "api", "config"]
})
```

This is the highest-priority trigger. Decisions are **logged the moment the user makes them** — not batched, not deferred. They're free (just a wiki page append) and would be lost if not captured immediately. Triggers include:

- User chooses between approaches
- Design trade-off is resolved
- Library/tool/pattern is selected
- User clarifies requirements or corrects the agent's approach

### 2. Before starting work → Query the wiki (FREE)

```
get_architecture_brief({})
plan_with_wiki({ task: "add WebSocket support to notifications" })
```

The agent calls these FIRST to get project context. Confidence scores tell it which pages to trust.

### 3. After a complete feature or PR → Report changes (ONCE)

```
notify_code_change({
  files: [
    { path: "src/auth/oauth.ts", type: "modified" },
    { path: "src/auth/tokens.ts", type: "created" }
  ],
  description: "Added OAuth flow for OpenAI",
  run_tier2: true
})
```

This is called **once per feature or PR-ready change** — not mid-work, not per file. The agent accumulates all changes and reports them in a single call at the end.

- **Tier 1** (always runs, free): Updates file path references, flags stale pages
- **Tier 2** (`run_tier2: true`): LLM reads changed files and updates affected wiki pages

Use `run_tier2: true` only for new features, refactors, renames, API changes. Skip it for bugfixes, config tweaks, test-only changes.

### 4. Before committing → Check staleness (FREE)

```
check_before_commit({ files: ["src/auth/oauth.ts", "src/config/models.ts"] })
```

### 5. End of conversation → Report completion (FREE)

```
report_task_complete({
  task_description: "Added rate limiting to API endpoints",
  files_changed: ["src/api/middleware.ts", "src/config/limits.ts"]
})
```

## Tool Cost Summary

| Tool | Cost | Frequency |
|------|------|-----------|
| `log_decision` | Free | Every decision (immediately) |
| `get_architecture_brief` | Free | Start of task |
| `plan_with_wiki` | Free | Start of task |
| `get_context_for_change` | Free | As needed |
| `check_before_commit` | Free | Before commit |
| `report_task_complete` | Free | End of task |
| `notify_code_change` (Tier 1) | Free | Once per feature/PR |
| `notify_code_change` (Tier 2) | ~2-5K tokens/page | Once per feature/PR |

## Manual Setup

If you prefer to add the instructions manually instead of running `axiom-wiki setup-agent`, copy the instructions from the [template source](https://github.com/axiom-wiki/axiom-wiki/blob/main/src/templates/agent-instructions.ts) into your agent's config file.

## Prerequisites

The MCP server must be configured first. See the [MCP Integration guide](/axiom-wiki/guides/mcp) for setup instructions.

You also need to run `axiom-wiki autowiki` at least once to build the initial wiki and `map-state.json`. The auto-update tools require this state file to know which wiki pages cover which source files.
