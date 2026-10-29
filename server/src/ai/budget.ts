import { AiError, type AiCallCtx, type BudgetGuard, type OpenRouterConfig, type Usage } from "./openrouter.js";
import type { Repo } from "../repo/types.js";

/** India date keys so "today" and "this month" match what the owner sees. */
export function istKeys(nowMs: number) {
  const day = new Date(nowMs + 5.5 * 3600_000).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}
export const toMicro = (usd: number) => Math.max(0, Math.round(usd * 1_000_000));

/**
 * Persistent AI budget: before every HTTP attempt we reserve the per-request maximum in MySQL (atomically, per owner);
 * afterwards the reservation is replaced by the real cost. Restarts don't reset anything, and a crash mid-request
 * leaves the reservation counted (fails safe, never under-counts).
 */
export function dbBudgetGuard(repo: Repo, cfg: OpenRouterConfig, now: () => number = Date.now): BudgetGuard {
  return {
    async reserve(ctx: AiCallCtx, model: string) {
      const { day, month } = istKeys(now());
      const r = await repo.reserveAi(ctx.ownerId, {
        feature: ctx.feature, model, day, month,
        reserveMicroUsd: toMicro(cfg.maxCostPerRequestUsd ?? 0.02),
        dailyLimitMicroUsd: toMicro(cfg.dailyCostLimitUsd),
        monthlyLimitMicroUsd: toMicro(cfg.monthlyCostLimitUsd ?? cfg.dailyCostLimitUsd * 31),
      });
      if (!r.ok) throw new AiError(r.limit === "daily" ? "Today's AI spending limit has been reached. It resets at midnight (India time)." : "This month's AI spending limit has been reached.", "budget_exceeded");
      return r.id;
    },
    async settle(ctx: AiCallCtx, id: string, u: Usage | null) {
      await repo.settleAi(ctx.ownerId, id, u
        ? { status: "settled", model: u.model.slice(0, 100), costMicroUsd: toMicro(u.costUsd), promptTokens: u.promptTokens, completionTokens: u.completionTokens, ms: u.ms }
        : { status: "failed", model: "", costMicroUsd: 0, promptTokens: 0, completionTokens: 0, ms: 0 });
    },
  };
}
