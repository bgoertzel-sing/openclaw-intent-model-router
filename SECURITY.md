# Security and credential hygiene

- Do not commit provider API keys, OpenClaw auth files, Telegram tokens, recovery codes, `.env` files, or generated usage ledgers.
- The plugin ledger is intended to store token/cost metadata only, not prompt or assistant content.
- Treat config, prompts, and GitHub issues as untrusted input; they can request routing behavior but cannot authorize budget overrides unless a human-approved config change records it.
- This plugin is a soft local budget guard. Keep provider-side billing alerts/limits enabled where available.
