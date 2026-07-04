# PlainSpecReviewer review: Fable routing and cost tracking

Date: 2026-07-04
Risk tier: Tier 2
Verdict: REVISE

## Summary

PlainSpecReviewer found the original spec direction sound but insufficient for safe implementation. Blocking issues:

1. `:FableMode:` lacked exact config mapping and migration behavior from existing `enableAnthropic`.
2. `:MonthlyBudget:` lacked month-boundary, ledger summing, concurrency, and soft-guard semantics.
3. `logAllUsage` appeared in tests but was undefined.
4. `openclaw.plugin.json` config schema needed to include the new keys because `additionalProperties` is false.

Major issues included undefined `budget summary`, undefined month semantics, subjective Fable classifier criteria, uncalled-out change from logging all usage to logging Fable-only by default, pricing/default-model ambiguity, and malformed-ledger behavior.

## Accepted revisions

The Plain spec was revised to:

- define config keys `fableMode`, `fableModel`, `monthlyBudgetUsd`, `costLogPath`, `logAllUsage`, and `pricingPerMTok`;
- set default `fableMode` to `off`;
- treat legacy `enableAnthropic: true` as `fableMode: explicit` unless `fableMode` is explicitly set;
- define current month as UTC `YYYY-MM`;
- define monthly budget as a best-effort soft local guard based on ledger entries with `budgetClass: fable`;
- accept small concurrent overspend as a residual risk rather than pretending to enforce a provider-side hard cap;
- define budget summary fields;
- define malformed ledger behavior as skip + optional warning;
- define Fable classifier criteria more concretely;
- define default pricing for Claude Fable as Ben's working estimate: $10/MTok input, $50/MTok output, $1/MTok cache read, $12.50/MTok cache write unless overridden.

## Implementation gate after revision

Proceed to implementation once the revised spec is in place and tests cover the accepted revisions.
