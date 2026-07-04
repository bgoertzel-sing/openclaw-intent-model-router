# Assumptions: Fable routing and cost tracking

- Anthropic API auth will be added later by Ben; the router must be safe before credentials exist.
- The exact OpenClaw model reference for Claude Fable may need adjustment after Anthropic auth/model discovery. The plugin therefore keeps `fableModel` configurable.
- Token usage from `llm_output` is the most reliable local accounting source available to this plugin; provider invoices remain authoritative.
- Monthly budget enforcement is a soft local guard based on this plugin's ledger, not a provider-side hard billing cap.
- This plugin instance can track usage it observes; if ZeroBot and ProtoMegaBot run in separate OpenClaw installations, they need either matching config and separate budgets or a shared ledger path.
- The initial safest `fableMode` should not cause accidental Anthropic spend before Ben deliberately enables it after the key is installed.
