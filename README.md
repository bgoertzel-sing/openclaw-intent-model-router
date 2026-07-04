# OpenClaw Intent Model Router

Reusable OpenClaw plugin for cost-aware model routing across Claw-style agents.

It was factored out from a local OmegaClaw/ProtomegaTron deployment so other OpenClaw agents can use the same pattern: route routine turns to a cheaper model, keep substantive technical work on a deep/default model, optionally escalate explicit or high-value prompts to Claude Fable, and enforce a fail-closed daily Fable budget using a local JSONL cost ledger.

## What it does

- Routes ordinary/simple turns to a configurable `routineModel`.
- Leaves serious technical/research/coding turns on the configured default/deep model unless Fable routing is explicitly enabled.
- Supports `fableMode`:
  - `off` — default; never route to Fable.
  - `explicit` — route to Fable only when the prompt explicitly asks for Claude/Fable.
  - `auto` — also route selected hard proof/math/architecture/stuck-debugging/research-design prompts to Fable.
- Enforces a best-effort daily Fable USD cap before selecting Fable.
- Defaults the Fable daily cap to `$0` unless `fableDailyBudgetUsd` is configured.
- Requires a same-day human-approved override to exceed the configured daily cap.
- Logs token/cost telemetry to JSONL without prompt text, assistant text, API keys, or secrets.

## Safety and cost boundaries

This plugin is a local soft guard, not a billing-system replacement.

- Provider billing is authoritative; the ledger is best-effort local accounting.
- Concurrent runs or final-token accounting can overshoot slightly because final usage is known only after a call.
- If the cost ledger cannot be read for a Fable routing decision, Fable routing fails closed to the deep/default model.
- `allowExplicitOverBudget` is deprecated and ignored.
- Budget override requires all of:
  - `fableDailyBudgetOverride.approvedBy` starts with `human`
  - override `date` matches the current budget day
  - non-empty `reason`
  - `limitUsd` greater than the normal daily limit

## Install into an OpenClaw profile

Clone this repository somewhere readable by the OpenClaw Gateway, then add it to plugin load paths and enable the plugin in the OpenClaw config.

Example conceptually:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/openclaw-intent-model-router"]
    },
    "entries": {
      "intent-model-router": {
        "enabled": true,
        "config": {
          "routineModel": "openrouter/z-ai/glm-5.2",
          "deepModel": "openai/gpt-5.5",
          "fableModel": "anthropic/claude-fable-5",
          "fableMode": "explicit",
          "fableDailyBudgetUsd": 10,
          "fableDailyBudgetTz": "America/Los_Angeles",
          "costLogPath": "~/openclaw-fable-usage.jsonl"
        }
      }
    }
  }
}
```

Use the exact config mechanism for your OpenClaw version/profile. Do not put provider API keys in this plugin config or in the ledger.

## Daily budget override example

A human can temporarily raise the same-day Fable limit by adding an override like:

```json
{
  "fableDailyBudgetOverride": {
    "approvedBy": "human:ben",
    "date": "2026-07-04",
    "reason": "Need Fable for one hard proof-debugging pass",
    "limitUsd": 25
  }
}
```

Remove the override after the day or when no longer needed.

## Ledger format

Ledger entries are JSONL. They include operational accounting fields such as timestamp, budget day, session/run identifiers when available, resolved model/provider refs, token counts, estimated USD cost, `budgetClass`, and the budget summary used for accounting.

They intentionally do **not** include prompts, assistant content, API keys, or secrets.

## Development

```bash
node --test index.test.js
node --check index.js
node --check router-core.js
jq empty openclaw.plugin.json
```

The tests exercise classification, Fable mode gating, fail-closed daily budget behavior, human override validation, cost estimation, and plugin schema/config surface.

## Status

Prototype plugin extracted from a working local OpenClaw/OmegaClaw setup. Model refs and plugin API compatibility may need adjustment for future OpenClaw releases or different provider adapters.

## License

License not yet selected. Add a license before treating this as generally redistributable software.
