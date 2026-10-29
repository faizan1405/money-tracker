import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { configureApiAuth } from "@/lib/api/client";
import { authApi } from "@/lib/api/services";
import type { AuthUser } from "@/lib/api/contracts";
import { readMode, writeMode, type AppMode } from "@/lib/api/config";

const SESSION_KEY = "moneyhub-session";

interface Session { token: string; expiresAt: string; user: AuthUser }
export type AuthStatus = "signed_out" | "signed_in" | "expired";

interface AuthCtx {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  modeReady: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("preview");
  const [modeReady, setModeReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("signed_out");

  const expire = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setStatus("expired");
  }, []);

  useEffect(() => {
    setModeState(readMode());
    const s = loadSession();
    if (s && new Date(s.expiresAt).getTime() > Date.now()) {
      setSession(s);
      setStatus("signed_in");
    } else if (s) {
      localStorage.removeItem(SESSION_KEY);
      setStatus("expired");
    }
    setModeReady(true);
  }, []);

  useEffect(() => {
    configureApiAuth(() => session?.token ?? null, expire);
  }, [session, expire]);

  // Expire automatically at the token deadline.
  useEffect(() => {
    if (!session) return;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    const t = setTimeout(expire, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [session, expire]);

  const login = async (email: string, password: string) => {
    const r = await authApi.login({ email, password });
    const s = { token: r.token, expiresAt: r.expiresAt, user: r.user };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    configureApiAuth(() => s.token, expire);
    setSession(s);
    setStatus("signed_in");
  };

  const logout = async () => {
    try {
      if (session) await authApi.logout();
    } catch {
      /* server logout best-effort; local session is cleared regardless */
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setStatus("signed_out");
  };

  const setMode = (m: AppMode) => {
    writeMode(m);
    setModeState(m);
  };

  return (
    <Ctx.Provider value={{ mode, setMode, modeReady, status, user: session?.user ?? null, login, logout }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
