import type { z } from "zod";

/**
 * Minimal OpenRouter client for sensitive financial data.
 * - Every request pins provider.zdr=true and data_collection="deny", plus require_parameters so only
 *   endpoints that honour strict JSON-schema output are used. If none qualify we fail; we never relax privacy.
 * - Logs only model, token counts, cost and latency — never prompts or responses.
 */
export interface OpenRouterConfig {
  apiKey: string;
  fastModel: string;
  strongModel: string;
  timeoutMs: number;
  maxRetries: number;
  maxCostPerStatementUsd: number;
  dailyCostLimitUsd: number;
  /** Persistent limits (enforced through a BudgetGuard backed by MySQL). */
  monthlyCostLimitUsd?: number;
  maxCostPerRequestUsd?: number;
  baseUrl?: string;
  appUrl?: string;
}

export type AiErrorCode = "not_configured" | "privacy_unavailable" | "rate_limited" | "timeout" | "provider_error" | "invalid_output" | "budget_exceeded";
export class AiError extends Error {
  constructor(message: string, public code: AiErrorCode) { super(message); }
}

export interface Usage { model: string; promptTokens: number; completionTokens: number; costUsd: number; ms: number }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown>; headers?: { get(n: string): string | null } }>;

export interface JsonRequest<T> {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validate: z.ZodType<T>;
  maxTokens?: number;
}

/** Who is spending and on what; required for the persistent budget. */
export interface AiCallCtx { ownerId: string; feature: "statement" | "assistant" | "insights" | "smoke" }
/** Reserve before every HTTP attempt, settle after. Implemented by ai/budget.ts on top of the database. */
export interface BudgetGuard {
  reserve(ctx: AiCallCtx, model: string): Promise<string>;
  settle(ctx: AiCallCtx, id: string, usage: Usage | null): Promise<void>;
}

export interface AiLogger { usage(u: Usage): void; error(msg: string, meta: Record<string, unknown>): void }
const consoleLogger: AiLogger = {
  usage: (u) => console.info(`[ai] model=${u.model} in=${u.promptTokens} out=${u.completionTokens} cost=$${u.costUsd.toFixed(6)} ms=${u.ms}`),
  error: (m, meta) => console.warn(`[ai] ${m}`, meta),
};

export class OpenRouterClient {
  private spentToday = 0;
  private day = "";
  /** When set (production), every call needs an AiCallCtx and is checked against persistent limits. */
  guard: BudgetGuard | null = null;
  constructor(public cfg: OpenRouterConfig, private fetchImpl: FetchLike = fetch as unknown as FetchLike, private log: AiLogger = consoleLogger, private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  /** Same transport, logger and budget guard with different limits (e.g. a shorter timeout for chat). */
  withOptions(patch: Partial<OpenRouterConfig>) {
    const c = new OpenRouterClient({ ...this.cfg, ...patch }, this.fetchImpl, this.log, this.sleep);
    c.guard = this.guard;
    return c;
  }

  /** Cost already spent today on this server process (best effort; resets on restart). */
  spent() { this.rollDay(); return this.spentToday; }
  private rollDay() { const d = new Date().toISOString().slice(0, 10); if (d !== this.day) { this.day = d; this.spentToday = 0; } }

  async json<T>(req: JsonRequest<T>, budget: { spentUsd: number; limitUsd?: number }, ctx?: AiCallCtx): Promise<{ data: T; usage: Usage }> {
    this.rollDay();
    if (this.guard && !ctx) throw new AiError("AI call without an owner context.", "provider_error");
    if (!this.guard && this.spentToday >= this.cfg.dailyCostLimitUsd) throw new AiError("Today's AI spending limit has been reached.", "budget_exceeded");
    if (budget.spentUsd >= (budget.limitUsd ?? this.cfg.maxCostPerStatementUsd)) throw new AiError("This request reached its AI spending limit.", "budget_exceeded");

    const body = JSON.stringify({
      model: req.model,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
      provider: { zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: true },
      temperature: 0,
      max_tokens: req.maxTokens ?? 4000,
      usage: { include: true },
    });
    let lastErr: AiError | null = null;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (attempt) await this.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
      const reservation = this.guard && ctx ? await this.guard.reserve(ctx, req.model) : null; // throws budget_exceeded
      let settled: Usage | null = null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
      const t0 = Date.now();
      try {
        const res = await this.fetchImpl(`${this.cfg.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json",
            ...(this.cfg.appUrl ? { "HTTP-Referer": this.cfg.appUrl } : {}), "X-Title": "Money Hub AI",
          },
          body, signal: ctl.signal,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: number };
          model?: string;
          choices?: { message?: { content?: string }; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        if (res.status === 429) { lastErr = new AiError("The AI service is busy. Try again in a minute.", "rate_limited"); continue; }
        if (res.status >= 500) { lastErr = new AiError("The AI service had an error.", "provider_error"); continue; }
        if (res.status === 404 || (res.status === 400 && /no endpoints|data policy|zdr|provider/i.test(payload.error?.message ?? ""))) {
          throw new AiError(`No zero-retention provider for ${req.model} supports strict JSON output right now. Privacy settings were not relaxed.`, "privacy_unavailable");
        }
        if (res.status === 401 || res.status === 403) throw new AiError("The OpenRouter API key was rejected.", "not_configured");
        if (res.status === 402) throw new AiError("The OpenRouter account has no credit left.", "budget_exceeded");
        if (res.status !== 200) throw new AiError(`The AI request failed (${res.status}).`, "provider_error");

        const usage: Usage = {
          model: payload.model ?? req.model, promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0, costUsd: payload.usage?.cost ?? 0, ms: Date.now() - t0,
        };
        settled = usage;
        if (this.cfg.maxCostPerRequestUsd && usage.costUsd > this.cfg.maxCostPerRequestUsd) this.log.error("request cost above per-request limit", { model: usage.model, costUsd: usage.costUsd });
        this.spentToday += usage.costUsd;
        budget.spentUsd += usage.costUsd;
        this.log.usage(usage);
        const content = payload.choices?.[0]?.message?.content;
        let parsed: unknown;
        try { parsed = JSON.parse(content ?? ""); } catch { lastErr = new AiError("The AI returned malformed output.", "invalid_output"); continue; }
        const v = req.validate.safeParse(parsed);
        if (!v.success) { lastErr = new AiError("The AI output didn't match the expected format.", "invalid_output"); continue; }
        return { data: v.data, usage };
      } catch (e) {
        if (e instanceof AiError) throw e;
        lastErr = (e as { name?: string }).name === "AbortError"
          ? new AiError("The AI service took too long to answer.", "timeout")
          : new AiError("Couldn't reach the AI service.", "provider_error");
      } finally {
        clearTimeout(timer);
        if (reservation && ctx) await this.guard!.settle(ctx, reservation, settled).catch((e: unknown) => this.log.error("could not record AI usage", { err: String(e) }));
      }
    }
    this.log.error("request failed after retries", { model: req.model, code: lastErr?.code });
    throw lastErr ?? new AiError("The AI request failed.", "provider_error");
  }
}
