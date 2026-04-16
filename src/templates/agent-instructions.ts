export interface AgentTemplate {
  agent: string
  filename: string
  displayName: string
  instructions: string
}

const CORE_INSTRUCTIONS = `## Axiom Wiki Integration

This project uses [axiom-wiki](https://github.com/axiom-wiki/axiom-wiki) for living documentation. The wiki auto-updates via MCP tools. You MUST call these tools at the specified trigger points to keep the wiki current.

### Trigger: Before starting any significant task
- Call \`get_architecture_brief\` or \`plan_with_wiki({ task: "your task description" })\` FIRST
- This gives you project context from the wiki — faster than scanning the codebase
- Check confidence scores: pages below 0.5 may be stale

### Trigger: After completing a logical unit of work (feature, bugfix, refactor)
- Call \`notify_code_change\` ONCE with ALL files you modified in that unit of work
- Do NOT call it after every single file edit — batch your changes
- Set \`run_tier2: true\` when:
  - You added a new feature or module
  - You refactored or renamed components
  - You deleted files or changed public APIs
- Set \`run_tier2: false\` (or omit) for:
  - Small bugfixes
  - Internal implementation changes
  - Config/dependency updates

### Trigger: When the user makes an architectural decision or clarification
- Call \`log_decision\` immediately when:
  - The user chooses between approaches ("use JWT not sessions")
  - A design trade-off is resolved ("prioritize speed over memory")
  - A library/tool/pattern is selected
  - The user clarifies requirements or constraints
- Include \`context\` (why), \`alternatives\` (what was considered), and \`affected_areas\`

### Trigger: At the end of a conversation or major task
- Call \`report_task_complete\` with a summary and list of changed files
- This ensures the next agent session starts with a current wiki

### Trigger: Before committing changes
- Call \`check_before_commit({ files: [...] })\` to see which wiki pages will go stale
- If many pages are affected, run \`notify_code_change\` with \`run_tier2: true\` first

### Tool reference
| Tool | When | Cost |
|------|------|------|
| \`get_architecture_brief\` | Start of task | Free (reads wiki) |
| \`plan_with_wiki\` | Start of task | Free (searches wiki) |
| \`get_context_for_change\` | Before modifying specific files | Free |
| \`check_before_commit\` | Before git commit | Free |
| \`notify_code_change\` (tier1 only) | After each logical unit of work | Free |
| \`notify_code_change\` (run_tier2) | After significant changes | ~2-5K tokens per page |
| \`report_task_complete\` | End of task/conversation | Free |
| \`log_decision\` | When user decides something | Free |
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
