---
title: MCP Integration
description: Use Axiom Wiki tools from Claude Code, Cursor, or any MCP client.
---

Axiom Wiki exposes all its tools as an MCP server for use with Claude Code, Cursor, or any MCP-compatible client.

## Setup

**Step 1.** Add to your Claude Code MCP config (`.claude/mcp_settings.json`):

```json
{
  "axiom-wiki": {
    "command": "axiom-wiki",
    "args": ["mcp"],
    "env": {}
  }
}
```

Or with pnpm dlx (no global install required):

```json
{
  "axiom-wiki": {
    "command": "pnpm",
    "args": ["dlx", "axiom-wiki", "mcp"],
    "env": {}
  }
}
```

**Step 2.** Restart Claude Code.

## Available tools

| Tool | Description |
|------|-------------|
| `read_page` | Read any wiki page |
| `write_page` | Create or update a page |
| `search_wiki` | Full-text search across all pages |
| `list_pages` | Browse the wiki catalog |
| `ingest_source` | Process a raw file into the wiki |
| `get_status` | Wiki statistics |
| `lint_wiki` | Health check data |
| `update_index` | Rebuild the wiki index |
| `update_moc` | Rebuild the tag-grouped Map of Content |
| `append_log` | Add a log entry |
| `list_sources` | All ingested sources with dates |
| `get_source` | Read a source's wiki summary |
| `remove_source` | Remove a source summary page |
| `get_contradictions` | Find all unresolved contradictions |
| `resolve_contradiction` | Apply a resolution |
| `analyze_graph` | Find orphan pages and dead links |

### Auto-update tools

These tools keep the wiki current as code changes:

| Tool | Description |
|------|-------------|
| `notify_code_change` | Report code changes to trigger wiki updates (Tier 1 + optional Tier 2) |
| `report_task_complete` | Log task completion and get staleness report |
| `log_decision` | Record architectural decisions and rationale |

### Planning tools

These tools help agents plan changes using wiki knowledge:

| Tool | Description |
|------|-------------|
| `get_architecture_brief` | Single-call project overview with staleness info |
| `plan_with_wiki` | Search wiki for context relevant to a task |
| `get_context_for_change` | Get wiki pages covering specific files |
| `check_before_commit` | Pre-commit staleness check |
| `get_wiki_health` | Wiki health status: staleness scores, sync info, recommendations |

**Format options:** The planning tools (`get_architecture_brief`, `plan_with_wiki`, `get_context_for_change`) accept an optional `format` parameter:

- `"full"` (default) — Complete markdown content
- `"compact"` — Frontmatter + first paragraph + cross-references (~80% token reduction)
- `"summary"` — Title + summary + tags only (~95% token reduction)

They also accept `maxTokens` to set a token budget — content is automatically truncated to fit.

## Resources

MCP resources provide ambient context that agents can pin without explicit tool calls:

| Resource URI | Description |
|---|---|
| `axiom://overview` | Project architecture overview (pin this for always-on context) |
| `axiom://index` | Full page index with summaries and staleness markers |
| `axiom://recent-changes` | Last 10 wiki log entries |

To configure your agent to call these tools automatically, see the [Agent Setup guide](/axiom-wiki/guides/agent-setup).
