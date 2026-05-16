---
title: auth
description: Authenticate provider credentials (OpenAI API key or OAuth).
---

```bash
axiom-wiki auth [subcommand]
```

Authenticate provider credentials and inspect auth status.

## Subcommands

```bash
axiom-wiki auth openai [--api-key <key>] [--activate]
axiom-wiki auth openai --oauth [--activate] [--no-open]
axiom-wiki auth status
axiom-wiki auth logout openai
```

- `openai`: Save OpenAI credentials for future sessions.
- `status`: Show whether OpenAI credentials are stored and which provider is active.
- `logout openai`: Remove stored OpenAI credentials if OpenAI is not currently active.

## API Key Options

- `--api-key <key>`: Provide the OpenAI key non-interactively.
- `--activate`: Immediately switch active provider/model to OpenAI after saving credentials.

## OAuth Options

Use OAuth mode with:

```bash
axiom-wiki auth openai --oauth
```

Required OAuth settings (env vars):

- `AXIOM_OPENAI_OAUTH_CLIENT_ID`
- `AXIOM_OPENAI_OAUTH_AUTH_URL`
- `AXIOM_OPENAI_OAUTH_TOKEN_URL`

Optional OAuth settings:

- `AXIOM_OPENAI_OAUTH_SCOPE` (default: `openid profile email`)
- `AXIOM_OPENAI_OAUTH_PORT` (default: `8787`)

CLI overrides (optional):

- `--client-id <id>`
- `--auth-url <url>`
- `--token-url <url>`
- `--scope <scope>`
- `--redirect-port <port>`
- `--no-open` (do not auto-open browser)

## Notes

- API keys are validated for basic shape (`sk-...`).
- If OpenAI is currently active, switch provider via `axiom-wiki model` before `auth logout openai`.
- OAuth support in Axiom Wiki is implementation-ready, but OpenAI account subscription billing and API billing may still be separate depending on OpenAI account plan and platform policy.
