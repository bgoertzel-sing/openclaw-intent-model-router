# Usage notes

## Recommended default posture

Start fail-closed:

```json
{
  "fableMode": "off",
  "fableDailyBudgetUsd": 0,
  "logAllUsage": false
}
```

Then move to explicit-only Fable routing with a small daily cap after provider credentials and billing controls are ready:

```json
{
  "fableMode": "explicit",
  "fableDailyBudgetUsd": 5
}
```

Use `auto` only after observing the classifier on your own agent traffic.

## Config reference

Important keys:

- `routineModel`: cheaper model for trivial/simple turns.
- `deepModel`: model for explicit deep fallback decisions; if omitted, the plugin leaves the Gateway/default model unchanged for deep work.
- `fableModel`: provider/model ref considered Fable for routing and ledger accounting.
- `fableMode`: `off`, `explicit`, or `auto`.
- `fableDailyBudgetUsd`: daily cap. Defaults to `0`.
- `fableDailyBudgetTz`: IANA timezone for budget day. Defaults to `America/Los_Angeles`.
- `fableDailyBudgetOverride`: same-day human override object.
- `costLogPath`: local JSONL ledger path.
- `logAllUsage`: when false, log only Fable usage.
- `pricingPerMTok`: override estimated prices per million tokens.

Deprecated keys:

- `monthlyBudgetUsd`: ignored for current Fable enforcement.
- `allowExplicitOverBudget`: ignored; use `fableDailyBudgetOverride`.
