import { API_TIMEOUT_MS, getApiBaseUrl } from "./config";
import type { ApiErrorBody } from "./contracts";

export type ApiErrorKind = "network" | "timeout" | "unauthorized" | "forbidden" | "not_found" | "validation" | "server" | "config";

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
    public details?: ApiErrorBody["details"],
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 409 || status === 422) return "validation";
  return "server";
}

type UnauthorizedHandler = (code?: string) => void;
let onUnauthorized: UnauthorizedHandler = () => {};

/** Wired by AuthProvider. Auth itself is an HttpOnly cookie the browser sends; JS never sees a token. */
export function configureApiAuth(u: UnauthorizedHandler) {
  onUnauthorized = u;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean; // default true
  signal?: AbortSignal | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/** Single entry point for every backend call. */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const base = opts.baseUrl ?? getApiBaseUrl();
  if (!base) throw new ApiError("config", "No backend address is configured. Add it in Settings → Data & privacy.");
  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), API_TIMEOUT_MS);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? null : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: ctrl.signal,
      credentials: "include", // sends the HttpOnly session cookie
    });
  } catch (e) {
    if (ctrl.signal.aborted && ctrl.signal.reason === "timeout") throw new ApiError("timeout", "The server took too long to respond.");
    throw new ApiError("network", "Can't reach the Money Hub server. Check your connection or the backend address.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = (json ?? {}) as Partial<ApiErrorBody>;
    const kind = kindForStatus(res.status);
    if (kind === "unauthorized" && opts.auth !== false) onUnauthorized(body.code);
    throw new ApiError(kind, body.message || `Request failed (${res.status})`, res.status, body.details, body.code);
  }
  return json as T;
}
