import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  DEFAULT_COST_LOG_PATH,
  appendJsonl,
  asConfig,
  computeBudgetSummary,
  estimateUsd,
  expandHome,
  isFableRef,
  modelParts,
  resolveModels,
  resolveRoutingDecision,
  sanitizeUsage,
  budgetDayKey,
  DEFAULT_BUDGET_TZ,
  DEFAULT_FABLE_DAILY_BUDGET_USD,
} from "./router-core.js";

export * from "./router-core.js";

export default definePluginEntry({
  id: "intent-model-router",
  name: "Intent Model Router",
  description: "Routes routine turns to GLM, serious turns to GPT-5.5/default, optional Fable escalations, and logs Fable cost telemetry.",
  register(api) {
    const lastDecisionByRun = new Map();

    api.on("before_model_resolve", (event, ctx) => {
      const config = asConfig(api.pluginConfig);
      if (config.enabled === false) return;

      const decision = resolveRoutingDecision({
        prompt: event.prompt,
        attachments: event.attachments,
        sessionKey: ctx.sessionKey,
        config,
        logger: api.logger,
      });
      if (ctx.runId) lastDecisionByRun.set(ctx.runId, decision);

      if (config.logDecisions === true) {
        const blocked = decision.blockedReason ? ` blocked=${decision.blockedReason}` : "";
        api.logger.info?.(`intent-model-router: ${decision.tier} via ${decision.reason}${blocked}; model=${decision.targetModel}; session=${ctx.sessionKey || "unknown"}`);
      }

      if (decision.tier === "deep" && (!config.deepModel || decision.targetModel === "openai/gpt-5.5")) return;
      return modelParts(decision.targetModel);
    }, { priority: 100, timeoutMs: 100 });

    api.on("llm_output", (event, ctx) => {
      const config = asConfig(api.pluginConfig);
      if (config.enabled === false || config.costTracking === false) return;

      const models = resolveModels(config);
      const resolvedRef = event.resolvedRef || `${event.provider}/${event.model}`;
      const isFable = isFableRef(resolvedRef, models.fableModel);
      if (!isFable && config.logAllUsage !== true) return;

      const usage = sanitizeUsage(event.usage);
      const estimatedUsd = estimateUsd({ resolvedRef, provider: event.provider, model: event.model, usage, pricing: config.pricingPerMTok });
      const budgetClass = isFable ? "fable" : "other";
      const budgetSummary = computeBudgetSummary({
        costLogPath: config.costLogPath || DEFAULT_COST_LOG_PATH,
        fableModel: models.fableModel,
        dailyBudgetUsd: config.fableDailyBudgetUsd ?? DEFAULT_FABLE_DAILY_BUDGET_USD,
        budgetTz: config.fableDailyBudgetTz || DEFAULT_BUDGET_TZ,
        dailyBudgetOverride: config.fableDailyBudgetOverride,
        logger: api.logger,
        warn: config.logCosts === true,
      });
      const decision = event.runId ? lastDecisionByRun.get(event.runId) : undefined;
      const record = {
        at: new Date().toISOString(),
        day: budgetDayKey(new Date(), config.fableDailyBudgetTz || DEFAULT_BUDGET_TZ),
        kind: "llm_output",
        runId: event.runId,
        sessionId: event.sessionId,
        sessionKey: ctx.sessionKey || undefined,
        provider: event.provider,
        model: event.model,
        resolvedRef,
        harnessId: event.harnessId,
        reasoningEffort: event.reasoningEffort,
        fastMode: event.fastMode,
        contextTokenBudget: event.contextTokenBudget,
        usage,
        estimatedUsd,
        budgetClass,
        budgetSummary,
        routerDecision: decision ? {
          tier: decision.tier,
          reason: decision.reason,
          blockedReason: decision.blockedReason,
          targetModel: decision.targetModel,
          isOmegaClaw: decision.isOmegaClaw,
        } : undefined,
      };

      appendJsonl(expandHome(config.costLogPath || DEFAULT_COST_LOG_PATH), record, api.logger);
      if (config.logCosts === true) {
        const costText = estimatedUsd === null ? "unpriced" : `$${estimatedUsd.toFixed(6)}`;
        api.logger.info?.(`intent-model-router: usage ${resolvedRef} input=${usage?.input ?? 0} output=${usage?.output ?? 0} cost=${costText} budgetClass=${budgetClass}`);
      }
    }, { priority: 0, timeoutMs: 250 });
  }
});
