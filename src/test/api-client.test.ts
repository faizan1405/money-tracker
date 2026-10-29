import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, configureApiAuth, kindForStatus } from "@/lib/api/client";
import { isValidApiUrl, normalizeUrl } from "@/lib/api/config";

const res = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("API client", () => {
  it("refuses to call anything when no server address is set (no silent demo fallback)", async () => {
    await expect(apiRequest("/api/bootstrap", { baseUrl: "" })).rejects.toMatchObject({ kind: "config" });
  });

  it("never sends a token header; relies on the HttpOnly cookie", async () => {
    const f = vi.fn(async () => res(200, { ok: true }));
    await apiRequest("/api/x", { baseUrl: "https://api.test", fetchImpl: f as unknown as typeof fetch });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("a 401 triggers session expiry", async () => {
    const expired = vi.fn();
    configureApiAuth(expired);
    const f = vi.fn(async () => res(401, { message: "expired", code: "session_expired" }));
    await expect(apiRequest("/api/x", { baseUrl: "https://api.test", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledWith("session_expired");
  });

  it("an unreachable server becomes a network error", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(apiRequest("/api/x", { baseUrl: "https://api.test", fetchImpl: f as unknown as typeof fetch })).rejects.toMatchObject({ kind: "network" });
  });

  it("maps status codes", () => {
    expect(kindForStatus(403)).toBe("forbidden");
    expect(kindForStatus(422)).toBe("validation");
    expect(kindForStatus(503)).toBe("server");
  });

  it("only allows https server addresses (http for localhost)", () => {
    expect(isValidApiUrl("https://api.example.com")).toBe(true);
    expect(isValidApiUrl("http://localhost:4000")).toBe(true);
    expect(isValidApiUrl("http://api.example.com")).toBe(false);
    expect(normalizeUrl("https://a.com///")).toBe("https://a.com");
  });
});

describe("API client timeout", () => {
  it("gives up after 15 seconds with a timeout error", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = apiRequest("/api/x", { baseUrl: "https://api.test", fetchImpl: f as unknown as typeof fetch });
    const check = expect(p).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(15001);
    await check;
    vi.useRealTimers();
  });
});
