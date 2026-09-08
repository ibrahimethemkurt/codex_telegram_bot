# Security Policy

## Supported version

Security fixes are applied to the latest revision of the default branch.

## Reporting a vulnerability

Please use the repository's [private vulnerability reporting](https://github.com/ibrahimethemkurt/codex_telegram_bot/security/advisories/new) page.

Do not open a public issue containing:

- Telegram bot tokens
- API keys or access tokens
- Telegram user IDs
- personal filesystem paths
- project source code or private Codex output

Include a minimal reproduction, affected version, expected impact and any suggested mitigation. Remove or redact all credentials first.

## If a credential was exposed

1. Revoke or rotate it immediately. For Telegram bots, use BotFather's `/revoke` command.
2. Replace the value only in the local `.env` file.
3. Run `npm run security:check`.
4. If the credential entered Git history, remove it from history. Rotation is still required even after history cleanup.

The project intentionally does not request or store an OpenAI API key. Codex authentication is provided by the user's existing local Codex installation.
