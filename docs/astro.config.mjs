import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://abubakarsiddik31.github.io',
  base: '/axiom-wiki',
  integrations: [
    starlight({
      title: 'Axiom Wiki',
      description: 'The wiki that maintains itself.',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/abubakarsiddik31/axiom-wiki' },
      ],
      editLink: {
        baseUrl: 'https://github.com/abubakarsiddik31/axiom-wiki/edit/main/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: '' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Local Project Wiki', slug: 'guides/local-wiki' },
            { label: 'Codebase Mapping', slug: 'guides/mapping' },
            { label: 'Interactive Ingest', slug: 'guides/interactive-ingest' },
            { label: 'Ollama (Offline)', slug: 'guides/ollama' },
            { label: 'MCP Integration', slug: 'guides/mcp' },
            { label: 'Obsidian', slug: 'guides/obsidian' },
            { label: 'Migration (v0.4 → v0.5)', slug: 'guides/migration' },
          ],
        },
        {
          label: 'Commands',
          items: [
            { label: 'init', slug: 'commands/init' },
            { label: 'ingest', slug: 'commands/ingest' },
            { label: 'query', slug: 'commands/query' },
            { label: 'map', slug: 'commands/map' },
            { label: 'sync', slug: 'commands/sync' },
            { label: 'watch', slug: 'commands/watch' },
            { label: 'clip', slug: 'commands/clip' },
            { label: 'sources', slug: 'commands/sources' },
            { label: 'review', slug: 'commands/review' },
            { label: 'graph', slug: 'commands/graph' },
            { label: 'model', slug: 'commands/model' },
            { label: 'status', slug: 'commands/status' },
            { label: 'mcp', slug: 'commands/mcp' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Wiki Structure', slug: 'reference/wiki-structure' },
            { label: 'File Types', slug: 'reference/file-types' },
            { label: 'LLM Providers', slug: 'reference/providers' },
            { label: 'Cost Tracking', slug: 'reference/cost-tracking' },
            { label: '.axiomignore', slug: 'reference/axiomignore' },
          ],
        },
      ],
    }),
  ],
});
