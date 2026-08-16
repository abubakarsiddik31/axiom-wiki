# Axiom Wiki v0.8.0

**One-command authentication — sign in to OpenAI with OAuth, no API key juggling.**

---

## Highlights

### The new `auth` command

Authenticating a provider is now a first-class CLI flow instead of copy-pasting keys into config:

```bash
axiom-wiki auth openai        # interactive: API key or OAuth
axiom-wiki auth openai --oauth  # browser sign-in (PKCE)
axiom-wiki auth status        # what's authenticated, what's active
axiom-wiki auth logout openai # clear stored credentials
```

### OAuth done right

- **PKCE authorization-code flow** — no client secret sitting on your machine.
- **Automatic OIDC discovery** with a default issuer — you usually don't configure any URLs.
- **Localhost callback server** — the code arrives without copy-pasting redirect URLs.
- **Token persistence** — access and refresh tokens survive restarts.

### Scriptable

For CI and headless setups: `--api-key <key>`, `--activate` (switch the active provider after auth), and `--oauth` for non-interactive flows. Every OAuth endpoint is overridable via `AXIOM_OPENAI_OAUTH_*` environment variables.

---

## Documentation

- New command reference: [`axiom-wiki auth`](https://abubakarsiddik31.github.io/axiom-wiki/commands/auth/)
- README section: *OpenAI OAuth*

---

**Full changelog**: see `CHANGELOG.md`.
