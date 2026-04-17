# Axiom Wiki v0.5.0

**Agent auto-update — your wiki stays current as you code.**

---

## Highlights

### Agent Auto-Update (Tier 1 + Tier 2 Sync)

The wiki can now update itself automatically when code changes. Two tiers of sync work together:

- **Tier 1 (instant, free)** — Deterministic updates. Renames, path references, and staleness flags are applied immediately with zero LLM calls. Handles file renames, deletions, and reference rewiring across wiki pages.
- **Tier 2 (LLM-based, batched)** — When pages become stale beyond a confidence threshold (0.5), the agent reads the changed source files and rewrites affected wiki pages. Cost-controlled with configurable limits.

The `notify_code_change` tool drives both tiers. Other agents (Claude Code, Cursor, Windsurf) can call it via MCP to keep the wiki in sync as they work.

### Planning Tools for AI Agents

Three new MCP tools give coding agents instant project context from the wiki — no codebase scanning needed:

| Tool | Purpose | Cost |
|------|---------|------|
| `get_architecture_brief` | Overview page + page listing + staleness summary | Free |
| `plan_with_wiki` | Search the wiki for context relevant to a task description | Free |
| `log_decision` | Record design decisions, trade-offs, and rationale | Free |

These tools are designed so that AI agents can call `get_architecture_brief` before starting any task, getting a complete project picture in a single call.

### `setup-agent` Command

New interactive CLI command (`axiom-wiki setup-agent`) that generates agent instruction files for Claude Code, Cursor, and Windsurf. The instructions teach each agent when and how to call the wiki's MCP tools — trigger points, cost rules, and batching guidelines.

Select which agents to configure, and the command writes (or appends to) their respective instruction files (`.claude/instructions.md`, `.cursor/rules/axiom-wiki.mdc`, `.windsurf/rules/axiom-wiki.md`).

### Task Lifecycle Tools

Two new tools for agents to report progress:

- `report_task_complete` — Detects changed files (via git diff), calculates wiki staleness, and returns recommendations on whether Tier 2 updates are needed.
- `check_wiki_status` — Returns current wiki health: total pages, stale page count, last sync commit.

---

## All Changes

### New Features
- **Tiered wiki sync** — `notify_code_change` with Tier 1 (deterministic) and Tier 2 (LLM-based) updates
- **Planning tools** — `get_architecture_brief`, `plan_with_wiki`, `log_decision` exposed via MCP
- **`setup-agent` command** — interactive agent instruction generator for Claude Code, Cursor, Windsurf
- **Task reporting tools** — `report_task_complete`, `check_wiki_status`
- **Agent instruction templates** — standardized instructions with cost rules and trigger points

### Improvements
- Agent tool orchestration optimized — tools accept optional `projectRoot` parameter for accurate path resolution
- Staleness confidence scores decay on file changes (0.85× per change), with Tier 1-handled pages excluded from decay
- State persistence improved in sync operations — `saveMapState` called after Tier 1 completes, before Tier 2 starts
- Error handling hardened in `incremental-sync.ts`, `sync.ts`, `wiki-sync-lite.ts`, and MCP server
- MCP server registers planning tools alongside existing wiki tools

### Internal
- Unused imports removed from planning tools
- `createAxiomTools` signature extended: `(config, projectRoot?)` for sync tool path resolution
- New files: `src/core/incremental-sync.ts` (Tier 2), `src/core/wiki-sync-lite.ts` (Tier 1), `src/mcp/planning-tools.ts`, `src/templates/agent-instructions.ts`, `src/cli/screens/setup-agent.tsx`

### Documentation
- New guide: `docs/src/content/docs/guides/agent-setup.md`
- MCP guide updated with planning tool documentation
- Search ranking, source management, and Obsidian compatibility docs updated

---

## Migration from 0.4.x

**No breaking changes.** Existing wikis work without modification.

- To use auto-update: enable the MCP server (`axiom-wiki mcp`) and have your coding agent call `notify_code_change` after changes
- To set up agent instructions: run `axiom-wiki setup-agent` in your project root
- Planning tools are available immediately via MCP — no configuration needed

---

## Stats

- 17 files changed
- +1,254 lines / -15 lines
- 5 commits since v0.4.0
