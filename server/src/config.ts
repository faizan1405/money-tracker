import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL must be a mysql:// URL"),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  CROSS_SITE_COOKIES: z.enum(["true", "false"]).default("true"),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(10),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(), // legacy single-model name → fast model
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_STRONG: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(45_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_COST_PER_STATEMENT_USD: z.coerce.number().min(0).default(0.05),
  AI_DAILY_COST_LIMIT_USD: z.coerce.number().min(0).default(1),
  AI_MAX_ROWS_PER_STATEMENT: z.coerce.number().int().min(1).max(2000).default(400),
});

/** Defaults verified on OpenRouter's zero-data-retention endpoint list with strict structured outputs (Oct 2026). */
export const DEFAULT_FAST_MODEL = "openai/gpt-4.1-mini";
export const DEFAULT_STRONG_MODEL = "openai/gpt-5-mini";

export interface AppConfig {
  isProd: boolean;
  port: number;
  corsOrigins: string[];
  sessionTtlMs: number;
  crossSiteCookies: boolean;
  uploadMaxBytes: number;
  version: string;
  ai?: import("./ai/openrouter.js").OpenRouterConfig | null;
  aiMaxRows?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = Env.parse(env);
  const origins = e.CORS_ORIGIN.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (origins.some((o) => o === "*")) throw new Error("CORS_ORIGIN must list exact origins, not *");
  return {
    isProd: e.NODE_ENV === "production",
    port: e.PORT,
    corsOrigins: origins,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    crossSiteCookies: e.CROSS_SITE_COOKIES === "true",
    uploadMaxBytes: e.UPLOAD_MAX_MB * 1024 * 1024,
    version: "0.3.0",
    aiMaxRows: e.AI_MAX_ROWS_PER_STATEMENT,
    ai: e.OPENROUTER_API_KEY?.trim()
      ? {
          apiKey: e.OPENROUTER_API_KEY.trim(), fastModel: e.AI_MODEL_FAST || e.OPENROUTER_MODEL || DEFAULT_FAST_MODEL, strongModel: e.AI_MODEL_STRONG || DEFAULT_STRONG_MODEL,
          timeoutMs: e.AI_TIMEOUT_MS, maxRetries: e.AI_MAX_RETRIES, maxCostPerStatementUsd: e.AI_MAX_COST_PER_STATEMENT_USD, dailyCostLimitUsd: e.AI_DAILY_COST_LIMIT_USD,
          appUrl: origins[0],
        }
      : null,
  };
}
