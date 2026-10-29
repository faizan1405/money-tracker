import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, configureApiAuth } from "@/lib/api/client";
import { authApi } from "@/lib/api/services";
import type { AuthUser } from "@/lib/api/contracts";
import { readMode, writeMode, type AppMode } from "@/lib/api/config";

/**
 * Production sign-in uses an HttpOnly cookie set by the server. Nothing secret is kept in
 * localStorage/sessionStorage: on load we ask the server (/api/auth/me) whether the cookie is valid.
 */
export type AuthStatus = "checking" | "signed_out" | "signed_in" | "expired" | "unreachable";

interface AuthCtx {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  modeReady: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  checkError: ApiError | null;
  recheck: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const LEGACY_KEY = "moneyhub-session"; // token storage from an earlier build — removed on load

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("preview");
  const [modeReady, setModeReady] = useState(false);
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<ApiError | null>(null);
  const [checkKey, setCheckKey] = useState(0);
  const signedIn = useRef(false);

  const expire = useCallback((code?: string) => {
    setUser(null);
    setExpiresAt(null);
    setStatus(code === "session_expired" || signedIn.current ? "expired" : "signed_out");
    signedIn.current = false;
  }, []);

  useEffect(() => {
    localStorage.removeItem(LEGACY_KEY);
    setModeState(readMode());
    setModeReady(true);
    configureApiAuth(expire);
  }, [expire]);

  // Ask the server whether the session cookie is still valid (survives refresh, never readable by JS).
  useEffect(() => {
    if (!modeReady || mode !== "production") return;
    let cancelled = false;
    setStatus("checking");
    setCheckError(null);
    authApi
      .me()
      .then((r) => {
        if (cancelled) return;
        signedIn.current = true;
        setUser(r.user);
        setExpiresAt(r.expiresAt);
        setStatus("signed_in");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const a = e instanceof ApiError ? e : null;
        if (a?.kind === "unauthorized") setStatus(a.code === "session_expired" ? "expired" : "signed_out");
        else if (a?.kind === "config") setStatus("signed_out");
        else {
          setCheckError(a ?? new ApiError("network", "Can't reach the Money Hub server."));
          setStatus("unreachable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, modeReady, checkKey]);

  // Expire in the UI at the server's deadline as well.
  useEffect(() => {
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const t = setTimeout(() => expire("session_expired"), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [expiresAt, expire]);

  const login = async (email: string, password: string) => {
    const r = await authApi.login({ email, password });
    signedIn.current = true;
    setUser(r.user);
    setExpiresAt(r.expiresAt);
    setStatus("signed_in");
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* cookie is cleared server-side when reachable; local state is cleared regardless */
    }
    signedIn.current = false;
    setUser(null);
    setExpiresAt(null);
    setStatus("signed_out");
  };

  const setMode = (m: AppMode) => {
    writeMode(m);
    setModeState(m);
  };

  return (
    <Ctx.Provider value={{ mode, setMode, modeReady, status, user, checkError, recheck: () => setCheckKey((n) => n + 1), login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
