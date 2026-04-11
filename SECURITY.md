# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: security@axiomwiki.dev (or open a [GitHub Security Advisory](https://github.com/abubakarsiddik31/axiom-wiki/security/advisories/new))

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

You can expect an acknowledgement within 48 hours. We will keep you updated as the issue is investigated and resolved.

## Scope

- API key handling and storage (`src/config/`)
- File path handling and traversal in `src/core/`
- Web clipper request handling in `src/core/clip.ts`
- MCP server in `src/mcp/`

## Out of scope

- Issues in third-party dependencies (report those upstream)
- Social engineering
