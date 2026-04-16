export interface AgentTemplate {
  agent: string
  filename: string
  displayName: string
  instructions: string
}

const CORE_INSTRUCTIONS = `## Axiom Wiki Integration

This project uses [axiom-wiki](https://github.com/axiom-wiki/axiom-wiki) for living documentation. The wiki auto-updates via MCP tools. You MUST call these tools at the specified trigger points.

### COST RULE: Code updates are expensive — batch aggressively
- \`notify_code_change\` with \`run_tier2: true\` costs LLM tokens. Call it AT MOST once per feature or PR — whichever comes first.
- NEVER call it per file, per function, or per small edit. Accumulate all changes, then call ONCE at the end.
- \`run_tier2: false\` (Tier 1 only) is free — use it for minor changes.
- All other tools (decisions, planning, status) are FREE — call them as often as needed.

### Trigger: Before starting any significant task (FREE)
- Call \`get_architecture_brief\` or \`plan_with_wiki({ task: "description" })\` FIRST
- This gives you project context from the wiki — faster than scanning the codebase
- Check confidence scores: pages below 0.5 may be stale

### Trigger: When the user makes a decision or clarification (FREE — call immediately)
- Call \`log_decision\` RIGHT AWAY when:
  - The user chooses between approaches ("use JWT not sessions")
  - A design trade-off is resolved ("prioritize speed over memory")
  - A library/tool/pattern is selected
  - The user clarifies requirements or constraints
  - The user corrects your approach or gives important context
- Include \`context\` (why), \`alternatives\` (what else was considered), and \`affected_areas\`
- This is free — do NOT batch or defer. Decisions are lost if not logged immediately.

### Trigger: After a complete feature or PR-ready change (ONCE — batched)
- Call \`notify_code_change\` ONCE with ALL files from the entire feature/PR
- This is the ONLY time you call it. Do NOT call it mid-work.
- Set \`run_tier2: true\` ONLY for:
  - New features or modules
  - Refactors that renamed/moved/deleted things
  - Public API or architecture changes
- Use \`run_tier2: false\` (or omit) for:
  - Bugfixes, config tweaks, dependency updates, test-only changes

### Trigger: End of conversation or task (FREE)
- Call \`report_task_complete\` with a summary and the full list of changed files
- Ensures the next agent session starts with a current wiki

### Trigger: Before committing (FREE)
- Call \`check_before_commit({ files: [...] })\` to see which wiki pages will go stale

### Tool cost summary
| Tool | Cost | When to call |
|------|------|--------------|
| \`get_architecture_brief\` | Free | Start of task |
| \`plan_with_wiki\` | Free | Start of task |
| \`get_context_for_change\` | Free | Before modifying files |
| \`check_before_commit\` | Free | Before git commit |
| \`log_decision\` | Free | IMMEDIATELY when user decides something |
| \`report_task_complete\` | Free | End of task/conversation |
| \`notify_code_change\` (tier1) | Free | Once per feature/PR |
| \`notify_code_change\` (tier2) | ~2-5K tokens/page | Once per feature/PR, only for significant changes |
`

function wrapForAgent(agent: string, core: string): string {
  switch (agent) {
    case 'cursor':
    case 'windsurf':
      // These use plain text rules — strip markdown formatting slightly
      return core
    default:
      return core
  }
}

export function getAgentTemplates(): AgentTemplate[] {
  return [
    {
      agent: 'claude-code',
      filename: 'CLAUDE.md',
      displayName: 'Claude Code',
      instructions: wrapForAgent('claude-code', CORE_INSTRUCTIONS),
    },
    {
      agent: 'codex',
      filename: 'AGENTS.md',
      displayName: 'OpenAI Codex',
      instructions: wrapForAgent('codex', CORE_INSTRUCTIONS),
    },
    {
      agent: 'cursor',
      filename: '.cursorrules',
      displayName: 'Cursor',
      instructions: wrapForAgent('cursor', CORE_INSTRUCTIONS),
    },
    {
      agent: 'windsurf',
      filename: '.windsurfrules',
      displayName: 'Windsurf',
      instructions: wrapForAgent('windsurf', CORE_INSTRUCTIONS),
    },
    {
      agent: 'gemini',
      filename: 'GEMINI.md',
      displayName: 'Google Gemini',
      instructions: wrapForAgent('gemini', CORE_INSTRUCTIONS),
    },
  ]
}

export function getTemplateForAgent(agent: string): AgentTemplate | null {
  return getAgentTemplates().find((t) => t.agent === agent) ?? null
}
