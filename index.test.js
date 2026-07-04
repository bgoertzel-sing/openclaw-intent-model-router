import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyOmegaClawPrompt,
  classifyPrompt,
  computeBudgetSummary,
  estimateUsd,
  resolveFableMode,
  resolveRoutingDecision,
} from "./router-core.js";

test("classifies routine, deep, explicit Fable, and auto Fable prompts", () => {
  assert.equal(classifyPrompt("thanks").tier, "routine");
  assert.equal(classifyPrompt("use glm for this").tier, "routine");
  assert.deepEqual(classifyPrompt("write a Python script to parse logs").tier, "deep");
  assert.deepEqual(classifyPrompt("inspect this repository and fix the failing pytest").tier, "deep");
  assert.deepEqual(classifyPrompt("use Claude Fable for this proof").tier, "fable");
  assert.deepEqual(classifyPrompt("please run this on fable").tier, "fable");
  assert.deepEqual(classifyPrompt("we are stuck debugging a subtle race condition after multiple failed fixes", { fableMode: "auto" }).tier, "fable");
  assert.deepEqual(classifyPrompt("develop a proof strategy for this theorem and check edge cases", { fableMode: "auto" }).tier, "fable");
});

test("Fable mode gates routing and preserves legacy enableAnthropic behavior", () => {
  assert.equal(resolveFableMode({}), "off");
  assert.equal(resolveFableMode({ enableAnthropic: true }), "explicit");
  assert.equal(resolveFableMode({ fableMode: "auto", enableAnthropic: true }), "auto");

  const prompt = "use Claude Fable for this proof";
  assert.equal(resolveRoutingDecision({ prompt, config: { fableMode: "off" } }).tier, "deep");
  assert.equal(resolveRoutingDecision({ prompt, config: { fableMode: "explicit", fableDailyBudgetUsd: 50 } }).tier, "fable");
  assert.equal(resolveRoutingDecision({ prompt, config: { enableAnthropic: true, fableDailyBudgetUsd: 50 } }).tier, "fable");

  const autoPrompt = "we are stuck debugging a subtle race condition after multiple failed fixes";
  assert.equal(resolveRoutingDecision({ prompt: autoPrompt, config: { fableMode: "explicit", fableDailyBudgetUsd: 50 } }).tier, "deep");
  assert.equal(resolveRoutingDecision({ prompt: autoPrompt, config: { fableMode: "auto", fableDailyBudgetUsd: 50 } }).tier, "fable");
});

test("daily budget defaults to $0 and blocks Fable unless a positive cap is set", () => {
  const prompt = "use Claude Fable for this proof";
  // Default daily budget is $0 → Fable blocked
  const blocked = resolveRoutingDecision({ prompt, config: { fableMode: "explicit" } });
  assert.equal(blocked.tier, "deep");
  assert.equal(blocked.blockedReason, "daily_budget_exceeded");

  // With a positive daily budget and no prior spend → Fable allowed
  const allowed = resolveRoutingDecision({ prompt, config: { fableMode: "explicit", fableDailyBudgetUsd: 50 } });
  assert.equal(allowed.tier, "fable");
  assert.equal(allowed.blockedReason, undefined);
});

test("daily budget excludes other days, skips malformed lines, and blocks Fable when spent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intent-router-test-"));
  const ledger = path.join(dir, "usage.jsonl");
  const today = "2026-07-04";
  fs.writeFileSync(ledger, [
    JSON.stringify({ day: "2026-07-03", budgetClass: "fable", resolvedRef: "anthropic/claude-fable-5", estimatedUsd: 9999 }),
    "not json",
    JSON.stringify({ day: today, budgetClass: "other", resolvedRef: "anthropic/claude-fable-5", estimatedUsd: 9999 }),
    JSON.stringify({ day: today, budgetClass: "fable", resolvedRef: "anthropic/claude-fable-5", estimatedUsd: 30 }),
  ].join("\n") + "\n");

  const now = new Date("2026-07-04T16:00:00Z");
  const summary = computeBudgetSummary({ costLogPath: ledger, dailyBudgetUsd: 50, now });
  assert.equal(summary.day, today);
  assert.equal(summary.dayToDateUsd, 30);
  assert.equal(summary.budgetExceeded, false);

  // At $30 spent with $50 cap → still allowed
  const allowed = resolveRoutingDecision({
    prompt: "use Claude Fable for this proof",
    config: { fableMode: "explicit", fableDailyBudgetUsd: 50, costLogPath: ledger },
    now,
  });
  assert.equal(allowed.tier, "fable");

  // Write another entry to push over budget
  fs.appendFileSync(ledger, JSON.stringify({ day: today, budgetClass: "fable", resolvedRef: "anthropic/claude-fable-5", estimatedUsd: 25 }) + "\n");
  const blocked = resolveRoutingDecision({
    prompt: "use Claude Fable for this proof",
    config: { fableMode: "explicit", fableDailyBudgetUsd: 50, costLogPath: ledger },
    now,
  });
  assert.equal(blocked.tier, "deep");
  assert.equal(blocked.blockedReason, "daily_budget_exceeded");
});

test("human-approved daily budget override unlocks higher spending for that day only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intent-router-test-"));
  const ledger = path.join(dir, "usage.jsonl");
  const today = "2026-07-04";
  fs.writeFileSync(ledger, [
    JSON.stringify({ day: today, budgetClass: "fable", resolvedRef: "anthropic/claude-fable-5", estimatedUsd: 50 }),
  ].join("\n"));

  const now = new Date("2026-07-04T16:00:00Z");
  const baseConfig = {
    fableMode: "explicit",
    fableDailyBudgetUsd: 50,
    costLogPath: ledger,
  };

  // Without override: blocked at $50 spent
  const blocked = resolveRoutingDecision({ prompt: "use Claude Fable for this proof", config: baseConfig, now });
  assert.equal(blocked.tier, "deep");
  assert.equal(blocked.blockedReason, "daily_budget_exceeded");

  // With valid human override for today at $100:
  const overrideConfig = {
    ...baseConfig,
    fableDailyBudgetOverride: {
      date: today,
      limitUsd: 100,
      approvedBy: "human:ben",
      reason: "need more time on proof task",
    },
  };
  const allowed = resolveRoutingDecision({ prompt: "use Claude Fable for this proof", config: overrideConfig, now });
  assert.equal(allowed.tier, "fable");
  assert.equal(allowed.blockedReason, undefined);

  // Override for wrong date → still blocked
  const wrongDay = resolveRoutingDecision({
    prompt: "use Claude Fable for this proof",
    config: { ...overrideConfig, fableDailyBudgetOverride: { ...overrideConfig.fableDailyBudgetOverride, date: "2026-07-03" } },
    now,
  });
  assert.equal(wrongDay.tier, "deep");
  assert.equal(wrongDay.blockedReason, "daily_budget_exceeded");

  // Override with non-human approvedBy → still blocked
  const nonHuman = resolveRoutingDecision({
    prompt: "use Claude Fable for this proof",
    config: { ...overrideConfig, fableDailyBudgetOverride: { ...overrideConfig.fableDailyBudgetOverride, approvedBy: "agent:bot" } },
    now,
  });
  assert.equal(nonHuman.tier, "deep");
  assert.equal(nonHuman.blockedReason, "daily_budget_exceeded");
});

test("cost estimation uses Fable pricing including cache", () => {
  const usd = estimateUsd({
    resolvedRef: "anthropic/claude-fable-5",
    usage: { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 },
  });
  assert.equal(usd, 15);
  const withCache = estimateUsd({
    resolvedRef: "anthropic/claude-fable-5",
    usage: { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
  });
  assert.equal(withCache, 13.5);
});

test("OmegaClaw conservative routing remains intact", () => {
  assert.equal(classifyOmegaClawPrompt("HUMAN_MESSAGE: thanks").tier, "routine");
  assert.equal(classifyOmegaClawPrompt("HUMAN_MESSAGE: inspect this repository and fix tests").tier, "deep");
  assert.equal(classifyOmegaClawPrompt("HUMAN_MESSAGE: use Claude Fable for this proof", { fableMode: "explicit" }).tier, "fable");
});

test("plugin config schema parses and includes daily budget config keys", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8")).configSchema;
  for (const key of ["fableModel", "fableMode", "fableDailyBudgetUsd", "fableDailyBudgetTz", "fableDailyBudgetOverride", "costLogPath", "logAllUsage", "pricingPerMTok", "enableAnthropic"]) {
    assert.ok(schema.properties[key], `missing schema key ${key}`);
  }
  // Override schema requires human-approvedBy pattern
  const overrideSchema = schema.properties.fableDailyBudgetOverride;
  assert.equal(overrideSchema.properties.approvedBy.pattern, "^human(:|$).*");
  assert.deepEqual(overrideSchema.required.sort(), ["approvedBy", "date", "limitUsd", "reason"]);
});
