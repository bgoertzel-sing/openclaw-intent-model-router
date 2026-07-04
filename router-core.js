import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_ROUTINE_MODEL = "openrouter/z-ai/glm-5.2";
export const DEFAULT_DEEP_MODEL = "openai/gpt-5.5";
export const DEFAULT_FABLE_MODEL = "anthropic/claude-fable-5";
export const DEFAULT_COST_LOG_PATH = "~/research-agent/plugins/intent-model-router/usage.jsonl";
export const DEFAULT_BUDGET_TZ = "America/Los_Angeles";
export const DEFAULT_FABLE_DAILY_BUDGET_USD = 0;

export const DEFAULT_PRICING_PER_MTOK = {
  "anthropic/claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

const DEEP_PATTERNS = [
  /\b(use\s+openai|use\s+gpt|gpt-5\.5|think\s+hard|deep\s+(technical|reasoning|analysis)|frontier\s+model)\b/i,
  /\b(debug|fix|implement|refactor|test|pytest|unit\s+test|build|compile|typecheck|lint|stack\s*trace|traceback|segfault|race\s+condition)\b/i,
  /\b(code|coding|repository|repo|git\s+(diff|commit|branch|merge|rebase)|pull\s+request|PR\b|CI\b)\b/i,
  /\b(research|paper|proof|theorem|formaliz(e|ation)|derive|algorithm|architecture|design\s+doc|benchmark|experiment|evaluate)\b/i,
  /\b(Hyperon|MeTTa|PeTTa|MORK|OmegaClaw|ThreadKeeper|Prolog|Rust|Python|AtomSpace|PLN|NARS)\b/i,
  /\b(multi[- ]?step|long[- ]?context|use\s+tools|run\s+commands?|inspect\s+files?|modify\s+files?|create\s+a\s+branch)\b/i,
];

const EXPLICIT_FABLE_PATTERNS = [
  /\b(use\s+)?(claude\s+)?fable\b/i,
  /\b(anthropic\s+fable|fable\s+model|fable\s+api)\b/i,
];

const AUTO_FABLE_PATTERNS = [
  /\b(stuck\s+debugging|multiple\s+failed\s+fixes|subtle\s+race\s+condition|hard\s+debugging|deep\s+debugging)\b/i,
  /\b(proof\s+strategy|prove\s+or\s+disprove|theorem|formal\s+proof|nontrivial\s+math|mathematical\s+proof)\b/i,
  /\b(architecture\s+decision|major\s+architecture|research\s+design|experimental\s+methodology|validity\s+threats)\b/i,
  /\b(escalate\s+to\s+(claude|anthropic)|best\s+reasoning\s+model|strongest\s+reasoning)\b/i,
];

const ROUTINE_PATTERNS = [/\b(use\s+glm|use\s+openrouter|cheap\s+model|routine\s+model)\b/i];
const OMEGACLAW_SESSION_MARKERS = [/protomegatron/i, /omegaclaw/i];

export function asConfig(value) {
  return value && typeof value === "object" ? value : {};
}

function validMode(value) {
  return value === "off" || value === "explicit" || value === "auto";
}

export function resolveFableMode(config = {}) {
  if (validMode(config.fableMode)) return config.fableMode;
  if (config.enableAnthropic === true) return "explicit";
  return "off";
}

function extractOmegaClawUserText(prompt) {
  const text = String(prompt || "");
  const matches = [...text.matchAll(/HUMAN_MESSAGE:?\s*['"]?([^'"\n]{1,500})/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  return text.slice(-500).trim();
}

export function classifyPrompt(prompt, config = {}) {
  const text = String(prompt || "");
  const fableMode = resolveFableMode(config);
  if (!text.trim()) return { tier: "routine", reason: "empty" };
  if (ROUTINE_PATTERNS.some((pattern) => pattern.test(text))) return { tier: "routine", reason: "explicit_routine" };
  if (EXPLICIT_FABLE_PATTERNS.some((pattern) => pattern.test(text))) return { tier: "fable", reason: "explicit_fable" };
  if (fableMode === "auto" && AUTO_FABLE_PATTERNS.some((pattern) => pattern.test(text))) return { tier: "fable", reason: "auto_fable" };
  if (DEEP_PATTERNS.some((pattern) => pattern.test(text))) return { tier: "deep", reason: "keyword" };
  if (text.length > 1800) return { tier: "deep", reason: "long_prompt" };
  if ((text.match(/```/g) || []).length >= 2) return { tier: "deep", reason: "code_block" };
  return { tier: "routine", reason: "default" };
}

export function classifyOmegaClawPrompt(prompt, config = {}) {
  const text = String(prompt || "").trim();
  if (!text) return { tier: "deep", reason: "omegaclaw_empty" };
  const classification = classifyPrompt(extractOmegaClawUserText(text), config);
  if (classification.tier === "routine") return { tier: "routine", reason: "omegaclaw_simple_chitchat" };
  if (classification.tier === "fable") return { tier: "fable", reason: classification.reason };
  return { tier: "deep", reason: "omegaclaw_substantive" };
}

export function modelParts(modelRef) {
  const model = String(modelRef || "").trim();
  const slash = model.indexOf("/");
  if (slash > 0) return { providerOverride: model.slice(0, slash), modelOverride: model.slice(slash + 1) };
  return { modelOverride: model };
}

export function expandHome(filePath) {
  const value = String(filePath || "").trim();
  if (!value) return null;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function budgetDayKey(date = new Date(), tz = DEFAULT_BUDGET_TZ) {
  const timeZone = typeof tz === "string" && tz.trim() ? tz.trim() : DEFAULT_BUDGET_TZ;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch {
    // Fall back to UTC if the configured timezone is invalid.
  }
  return date.toISOString().slice(0, 10);
}

function pricingFor(ref, pricingConfig) {
  const merged = { ...DEFAULT_PRICING_PER_MTOK, ...asConfig(pricingConfig) };
  const exact = merged[ref];
  if (exact && typeof exact === "object") return exact;
  return null;
}

export function estimateUsd({ resolvedRef, provider, model, usage, pricing }) {
  const ref = resolvedRef || (provider && model ? `${provider}/${model}` : "");
  const p = pricingFor(ref, pricing);
  if (!p || !usage) return null;
  const usd = (
    finiteNumber(usage.input) * finiteNumber(p.input) +
    finiteNumber(usage.output) * finiteNumber(p.output) +
    finiteNumber(usage.cacheRead) * finiteNumber(p.cacheRead) +
    finiteNumber(usage.cacheWrite) * finiteNumber(p.cacheWrite)
  ) / 1_000_000;
  return Number.isFinite(usd) ? usd : null;
}

export function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    total: finiteNumber(usage.total),
  };
}

export function isFableRef(ref, fableModel) {
  return String(ref || "") === String(fableModel || DEFAULT_FABLE_MODEL);
}

function fableBudgetOverride(config, day) {
  const override = asConfig(config.fableDailyBudgetOverride);
  const approvedBy = typeof override.approvedBy === "string" ? override.approvedBy.trim().toLowerCase() : "";
  const reason = typeof override.reason === "string" ? override.reason.trim() : "";
  const overrideDate = typeof override.date === "string" ? override.date.trim() : "";
  const limitUsd = Number(override.limitUsd);
  if (overrideDate === day && approvedBy.startsWith("human") && reason.length > 0 && Number.isFinite(limitUsd) && limitUsd >= 0) {
    return { active: true, limitUsd, approvedBy: override.approvedBy, reason };
  }
  return { active: false };
}

export function computeBudgetSummary({
  costLogPath,
  fableModel = DEFAULT_FABLE_MODEL,
  dailyBudgetUsd = DEFAULT_FABLE_DAILY_BUDGET_USD,
  budgetTz = DEFAULT_BUDGET_TZ,
  dailyBudgetOverride,
  now = new Date(),
  logger,
  warn = false,
} = {}) {
  const day = budgetDayKey(now, budgetTz);
  const baseDailyBudgetUsd = finiteNumber(dailyBudgetUsd);
  const override = fableBudgetOverride({ fableDailyBudgetOverride: dailyBudgetOverride }, day);
  const overrideActive = override.active && override.limitUsd > baseDailyBudgetUsd;
  const dailyBudgetUsdEffective = overrideActive ? override.limitUsd : baseDailyBudgetUsd;
  let dayToDateUsd = 0;
  let countedRecords = 0;
  let malformedRecords = 0;
  let ledgerReadable = true;
  const filePath = expandHome(costLogPath || DEFAULT_COST_LOG_PATH);
  if (filePath && fs.existsSync(filePath)) {
    let text = "";
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      ledgerReadable = false;
      logger?.warn?.(`intent-model-router: failed to read cost ledger: ${String(err?.message || err)}`);
    }
    if (ledgerReadable) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const entryDay = typeof entry?.day === "string"
            ? entry.day
            : (typeof entry?.billingDay === "string" ? entry.billingDay : (entry?.at ? budgetDayKey(new Date(entry.at), budgetTz) : null));
          if (entryDay !== day) continue;
          if (entry?.budgetClass !== "fable") continue;
          if (entry?.resolvedRef && !isFableRef(entry.resolvedRef, fableModel)) continue;
          dayToDateUsd += finiteNumber(entry.estimatedUsd);
          countedRecords += 1;
        } catch (err) {
          malformedRecords += 1;
          if (warn) logger?.warn?.(`intent-model-router: skipping malformed cost ledger line: ${String(err?.message || err)}`);
        }
      }
    }
  }
  const remainingUsd = Math.max(0, dailyBudgetUsdEffective - dayToDateUsd);
  const dailyBudgetExceeded = dailyBudgetUsdEffective <= 0 || dayToDateUsd >= dailyBudgetUsdEffective;
  return {
    day,
    budgetTz,
    dailyBudgetUsd: dailyBudgetUsdEffective,
    baseDailyBudgetUsd,
    overrideActive,
    override: overrideActive ? override : undefined,
    dayToDateUsd,
    remainingUsd,
    countedRecords,
    malformedRecords,
    ledgerReadable,
    budgetExceeded: !ledgerReadable || dailyBudgetExceeded,
    blockedReason: !ledgerReadable ? "cost_ledger_unreadable" : (dailyBudgetExceeded ? "daily_budget_exceeded" : undefined),
  };
}

export function appendJsonl(filePath, record, logger) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    logger?.warn?.(`intent-model-router: failed to append cost ledger: ${String(err?.message || err)}`);
  }
}

export function resolveModels(config) {
  return {
    routineModel: typeof config.routineModel === "string" && config.routineModel.trim() ? config.routineModel.trim() : DEFAULT_ROUTINE_MODEL,
    deepModel: typeof config.deepModel === "string" && config.deepModel.trim() ? config.deepModel.trim() : DEFAULT_DEEP_MODEL,
    fableModel: typeof config.fableModel === "string" && config.fableModel.trim() ? config.fableModel.trim() : DEFAULT_FABLE_MODEL,
  };
}

export function resolveRoutingDecision({ prompt, attachments, sessionKey = "", config = {}, logger, now } = {}) {
  const cfg = asConfig(config);
  const models = resolveModels(cfg);
  const fableMode = resolveFableMode(cfg);
  const isOmegaClaw = OMEGACLAW_SESSION_MARKERS.some((m) => m.test(String(sessionKey || "")));
  let classification;
  if (Array.isArray(attachments) && attachments.length > 0) classification = { tier: "deep", reason: "attachment" };
  else classification = isOmegaClaw ? classifyOmegaClawPrompt(prompt, cfg) : classifyPrompt(prompt, cfg);

  let targetTier = classification.tier;
  let targetModel = null;
  let budgetSummary;

  if (targetTier === "fable") {
    if (fableMode === "off") {
      targetTier = "deep";
      classification = { ...classification, blockedReason: "fable_mode_off" };
    } else if (fableMode === "explicit" && classification.reason !== "explicit_fable") {
      targetTier = "deep";
      classification = { ...classification, blockedReason: "fable_explicit_only" };
    } else {
      budgetSummary = computeBudgetSummary({
        costLogPath: cfg.costLogPath || DEFAULT_COST_LOG_PATH,
        fableModel: models.fableModel,
        dailyBudgetUsd: cfg.fableDailyBudgetUsd ?? DEFAULT_FABLE_DAILY_BUDGET_USD,
        budgetTz: cfg.fableDailyBudgetTz || DEFAULT_BUDGET_TZ,
        dailyBudgetOverride: cfg.fableDailyBudgetOverride,
        now,
        logger,
        warn: cfg.logCosts === true || cfg.logDecisions === true,
      });
      if (budgetSummary.budgetExceeded) {
        targetTier = "deep";
        classification = { ...classification, blockedReason: budgetSummary.blockedReason || "daily_budget_exceeded" };
      }
    }
  }

  if (targetTier === "routine") targetModel = models.routineModel;
  else if (targetTier === "fable") targetModel = models.fableModel;
  else targetModel = models.deepModel;

  return {
    tier: targetTier,
    reason: classification.reason,
    blockedReason: classification.blockedReason,
    targetModel,
    isOmegaClaw,
    fableMode,
    budgetSummary,
  };
}
