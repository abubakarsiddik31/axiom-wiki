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

Or with npx (no global install required):

```json
{
  "axiom-wiki": {
    "command": "npx",
    "args": ["axiom-wiki", "mcp"],
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
| `append_log` | Add a log entry |
| `list_sources` | All ingested sources with dates |
| `get_source` | Read a source's wiki summary |
| `remove_source` | Remove a source summary page |
| `get_contradictions` | Find all unresolved contradictions |
| `resolve_contradiction` | Apply a resolution |
| `analyze_graph` | Find orphan pages and dead links |
