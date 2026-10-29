import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "./config.js";
import { HttpError } from "./http.js";
import type { Repo } from "./repo/types.js";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1, LEN = 64;

/** scrypt (memory-hard, built into Node → no native build on Hostinger). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Dummy hash so unknown emails take the same time as wrong passwords. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString("hex")));

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export const COOKIE = "mh_session";

export function cookieOptions(cfg: AppConfig, maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: cfg.isProd || cfg.crossSiteCookies,
    sameSite: cfg.crossSiteCookies ? ("none" as const) : ("strict" as const),
    path: "/api",
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

declare module "express-serve-static-core" {
  interface Request {
    ownerId?: string;
    tokenHash?: string;
  }
}

function readToken(req: Request): { token: string; via: "bearer" | "cookie" } | null {
  const h = req.get("authorization");
  if (h?.startsWith("Bearer ")) return { token: h.slice(7).trim(), via: "bearer" };
  const c = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
  return c ? { token: c, via: "cookie" } : null;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Requires a valid, unexpired session. Accepts the HttpOnly cookie or a Bearer token (current frontend).
 * CSRF: cookie-authenticated writes must come from an allowed Origin. Bearer requests can't be forged cross-site.
 */
export function requireAuth(repo: Repo, cfg: AppConfig, now: () => number = Date.now) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = readToken(req);
      if (!t) throw new HttpError(401, "Please sign in", "unauthenticated");
      if (t.via === "cookie" && !SAFE.has(req.method)) {
        const origin = req.get("origin");
        if (!origin || !cfg.corsOrigins.includes(origin)) throw new HttpError(403, "Request origin not allowed", "csrf");
      }
      const hash = sha256(t.token);
      const s = await repo.findSession(hash);
      if (!s) throw new HttpError(401, "Please sign in", "unauthenticated");
      if (s.expiresAt.getTime() <= now()) {
        await repo.deleteSession(hash);
        res.clearCookie(COOKIE, cookieOptions(cfg));
        throw new HttpError(401, "Your session expired", "session_expired");
      }
      req.ownerId = s.ownerId;
      req.tokenHash = hash;
      next();
    } catch (e) {
      next(e);
    }
  };
}
