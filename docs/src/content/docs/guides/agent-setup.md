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

## When Does the Agent Trigger Updates?

The instructions define **5 specific trigger points** so the agent knows exactly when to act:

### 1. Before starting a task → Query the wiki

```
get_architecture_brief({})
plan_with_wiki({ task: "add WebSocket support to notifications" })
```

The agent calls these FIRST to get project context. Confidence scores tell it which pages to trust.

### 2. After a logical unit of work → Report changes

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

**Important:** The agent batches changes — it does NOT call this after every single file edit. One call per feature/bugfix/refactor.

- **Tier 1** (always runs, free): Updates file path references, flags stale pages
- **Tier 2** (`run_tier2: true`, ~2-5K tokens/page): LLM reads changed files and updates wiki pages

When to use `run_tier2: true`:
- New features or modules
- Refactors, renames, API changes
- File deletions

When to skip Tier 2:
- Small bugfixes, config changes, dependency updates

### 3. When the user decides something → Log it

```
log_decision({
  decision: "Chose JWT over session cookies for auth",
  context: "Need stateless auth for horizontal scaling",
  alternatives: ["Session cookies", "OAuth tokens"],
  affected_areas: ["auth", "api", "config"]
})
```

Triggered when the user:
- Chooses between approaches
- Resolves a design trade-off
- Selects a library, tool, or pattern
- Clarifies requirements or constraints

Creates a running log at `wiki/pages/analyses/decisions.md`.

### 4. Before committing → Check staleness

```
check_before_commit({ files: ["src/auth/oauth.ts", "src/config/models.ts"] })
```

Reports which wiki pages will go stale. If many are affected, the agent runs `notify_code_change` with Tier 2 first.

### 5. End of conversation/task → Report completion

```
report_task_complete({
  task_description: "Added rate limiting to API endpoints",
  files_changed: ["src/api/middleware.ts", "src/config/limits.ts"]
})
```

Ensures the next agent session starts with a current wiki.

## Tool Cost Reference

| Tool | Cost |
|------|------|
| `get_architecture_brief` | Free |
| `plan_with_wiki` | Free |
| `get_context_for_change` | Free |
| `check_before_commit` | Free |
| `notify_code_change` (Tier 1 only) | Free |
| `notify_code_change` (Tier 2) | ~2-5K tokens per page |
| `report_task_complete` | Free |
| `log_decision` | Free |

## Manual Setup

If you prefer to add the instructions manually instead of running `axiom-wiki setup-agent`, copy the instructions from the [template source](https://github.com/axiom-wiki/axiom-wiki/blob/main/src/templates/agent-instructions.ts) into your agent's config file.

## Prerequisites

The MCP server must be configured first. See the [MCP Integration guide](/guides/mcp/) for setup instructions.

You also need to run `axiom-wiki autowiki` at least once to build the initial wiki and `map-state.json`. The auto-update tools require this state file to know which wiki pages cover which source files.
