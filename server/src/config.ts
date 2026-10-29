import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL must be a mysql:// URL"),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  CROSS_SITE_COOKIES: z.enum(["true", "false"]).default("true"),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(10),
});

export interface AppConfig {
  isProd: boolean;
  port: number;
  corsOrigins: string[];
  sessionTtlMs: number;
  crossSiteCookies: boolean;
  uploadMaxBytes: number;
  version: string;
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
    version: "0.2.0",
  };
}
