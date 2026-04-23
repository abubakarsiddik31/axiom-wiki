# Production Readiness: Hybrid Semantic Search

## Objective
Finalize the Hybrid Semantic Search implementation by ensuring all agent/MCP tools utilize the new engine, updating documentation, and adding robustness checks.

## Implementation Plan

- [ ] **Enable Semantic Search in Agent Tools**. Update `src/agent/tools.ts` to pass the `config` object to `search.searchWiki` in the `search_wiki` tool. *Rationale: Ensures the AI agent can leverage semantic context during queries.*
- [ ] **Enable Semantic Search in MCP Tools**. Update `src/mcp/planning-tools.ts` to pass the `config` object to `searchMod.searchWiki` in the `plan_with_wiki` tool. *Rationale: Enables semantic search for external agents like Claude Code or Cursor.*
- [ ] **Update README.md**. Add the `embed` command to the command list and add a section about Semantic Search (Google/OpenAI/Ollama support). *Rationale: Essential for user discovery and onboarding.*
- [ ] **Update CLAUDE.md**. Add `search.index` to the wiki structure and update the "Architecture" and "State Tracking" sections to include the new search layer and indexing requirements. *Rationale: Keeps the development guide current for future maintenance.*
- [ ] **Enhance Orama Robustness**. Add a check in `src/core/search/orama-store.ts` to detect and handle dimension mismatches during index loading (e.g., if a user changes models). *Rationale: Prevents crashes when switching embedding providers.*
- [ ] **Final Build Verification**. Run `npm run build` to ensure all changes are type-safe and error-free. *Rationale: Confirms production readiness.*

## Verification Criteria
- [ ] `axiom-wiki query` uses semantic results when configured.
- [ ] `plan_with_wiki` MCP tool returns semantically relevant pages.
- [ ] `README.md` correctly describes the `embed` command.
- [ ] Switching from OpenAI to Ollama embeddings triggers a graceful re-index prompt or handles the error without crashing.

## Potential Risks and Mitigations
1. **API Rate Limits**: Rapid sequential indexing might hit limits.
   - Mitigation: Sequential processing is currently used; if performance becomes an issue, implement chunked `embedMany`.
2. **Index Corruption**: Binary/JSON index files might get corrupted.
   - Mitigation: `getOrama` already has a try/catch that recreates the index on failure.
