/**
 * App mode + backend configuration.
 * - preview: fictional local demo data only, no network.
 * - production: real backend API only, sign-in required. Never falls back to demo data.
 */
export type AppMode = "preview" | "production";

const MODE_KEY = "moneyhub-mode";
const URL_KEY = "moneyhub-api-url";

export function envApiUrl(): string {
  const v = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
  return v.trim();
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const o = localStorage.getItem(URL_KEY);
    if (o && o.trim()) return normalizeUrl(o);
  }
  return normalizeUrl(envApiUrl());
}

export function setApiBaseUrl(url: string) {
  if (url.trim()) localStorage.setItem(URL_KEY, normalizeUrl(url));
  else localStorage.removeItem(URL_KEY);
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isValidApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

export function readMode(): AppMode {
  if (typeof window === "undefined") return "preview";
  return localStorage.getItem(MODE_KEY) === "production" ? "production" : "preview";
}

export function writeMode(m: AppMode) {
  localStorage.setItem(MODE_KEY, m);
}

export const API_TIMEOUT_MS = 15000;
