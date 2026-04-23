# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-04-23

### Added
- **Hybrid Semantic Search**: A major upgrade to the search engine combining lexical (keyword) and vector (semantic) search using Orama v3.
- **Multi-Provider Embeddings**: Support for Google Gemini (`text-embedding-004`), OpenAI (`text-embedding-3-small`), and Ollama (`nomic-embed-text`).
- **`axiom-wiki embed` command**: New CLI command for managing semantic search (setup, status, re-indexing).
- **Interactive Shell Upgrades**: Added `/embed` and `/init` commands to the interactive REPL.
- **Real-time Indexing**: Automatic vector updates during source ingestion, wiki sync, and code changes (via MCP).
- **Health Tracking**: Integrated semantic index health into `get_wiki_health` and the CLI status screen.
- **Agent.md**: A dedicated reference file for AI agents working on the project.

### Changed
- **Dependency Migration**: Fully transitioned from `npm` to `pnpm` for package management.
- **Search Core**: Refactored `searchWiki` to use Orama's hybrid search mode with Reciprocal Rank Fusion (RRF).
- **Documentation**: Updated all guides and command references to reflect semantic capabilities and `pnpm` usage.

### Fixed
- **UI Persistence**: Resolved an issue where slash command outputs in the interactive shell would vanish immediately.
- **Orama Integration**: Fixed serialization and counting issues with Orama v3 API.
- **Path Resolution**: Fixed a bug where the semantic index was being looked for in the wrong directory.

## [0.6.0] - 2026-04-15

### Added
- **Provider Expansion**: Support for OpenRouter, DeepSeek, Groq, and Mistral AI.
- **MCP Overhaul**: New planning tools (`plan_with_wiki`, `get_architecture_brief`) and resources (`axiom://overview`).
- **Token Efficiency**: Introduced `compact` and `summary` formats for agent context reduction.
- **Health Monitoring**: Initial implementation of `get_wiki_health` for staleness tracking.

## [0.5.0] - 2026-04-01

### Added
- **Tier 2 Incremental Sync**: Surgical wiki updates after code changes.
- **File Watcher**: Continuous monitoring of source files for automatic ingestion.
- **Web Clipper**: Integrated command to clip and ingest URLs.

## [0.4.0] - 2026-03-15

### Added
- **MCP Server**: Initial implementation of the Model Context Protocol server.
- **Autowiki**: Automated generation of wiki pages from codebase analysis.

## [0.3.0] - 2026-02-28

### Added
- **Interactive Query Mode**: REPL for chatting with the wiki.
- **Source Management**: Screen to list, view, and delete ingested sources.

## [0.2.0] - 2026-02-10

### Added
- **Basic Ingestion**: Support for Markdown and Text files.
- **Entity Extraction**: Initial agent logic for identifying people and concepts.

## [0.1.0] - 2026-01-20

### Added
- Initial release with core wiki structure and basic CLI.

[0.7.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abubakarsiddik31/axiom-wiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/abubakarsiddik31/axiom-wiki/releases/tag/v0.1.0
