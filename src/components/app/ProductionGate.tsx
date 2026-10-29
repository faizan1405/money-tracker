import { useState, type ReactNode } from "react";
import { AlertTriangle, Clock, KeyRound, Loader2, LogIn, RefreshCw, ServerCrash, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/session";
import { useFinance } from "@/lib/finance/store";
import { ApiError } from "@/lib/api/client";
import { getApiBaseUrl } from "@/lib/api/config";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18V7l8 6 8-6v11" /></svg>
          </span>
          <div className="leading-tight"><div className="font-display text-xl font-semibold">Money Hub</div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Production</div></div>
        </div>
        <div className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function BackToPreview() {
  const { setMode } = useAuth();
  return (
    <button onClick={() => setMode("preview")} className="mt-5 w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground">
      Switch back to Preview Mode (demo data)
    </button>
  );
}

export function LoginScreen({ expired }: { expired?: boolean }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const noUrl = !getApiBaseUrl();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email address.");
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e2) {
      const a = e2 instanceof ApiError ? e2 : null;
      setErr(a?.kind === "unauthorized" || a?.kind === "validation" ? "Email or password is incorrect." : (a?.message ?? "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      {expired && (
        <div className="mb-5 flex gap-3 rounded-2xl bg-warning-soft p-3 text-sm text-warning">
          <Clock className="mt-0.5 size-4 shrink-0" /><div><div className="font-semibold">Your session expired</div><div className="text-xs opacity-90">For your security, please sign in again.</div></div>
        </div>
      )}
      <h1 className="font-display text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Access your real accounts and transactions.</p>
      {noUrl && (
        <div className="mt-4 flex gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />No server address is set yet. Switch to Preview, then add it in Settings → Data & privacy.</div>
      )}
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" className="mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy || noUrl}>{busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}Sign in</Button>
      </form>
      <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Your password is sent only to your own Money Hub server.</div>
      <BackToPreview />
    </Frame>
  );
}

export function ConnectionError({ error, onRetry }: { error: ApiError | null; onRetry: () => void }) {
  const { logout } = useAuth();
  return (
    <Frame>
      <div className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive"><ServerCrash className="size-6" /></div>
      <h1 className="mt-4 font-display text-2xl font-semibold">Can't reach Money Hub</h1>
      <p className="mt-1 text-sm text-muted-foreground">{error?.message ?? "The server is unavailable."}</p>
      <p className="mt-3 text-xs text-muted-foreground">No demo data is shown in Production Mode, so nothing here is out of date or made up.</p>
      <div className="mt-2 break-all rounded-lg bg-secondary px-3 py-2 font-mono text-[11px] text-muted-foreground">{getApiBaseUrl() || "no address set"}</div>
      <div className="mt-5 flex gap-2">
        <Button onClick={onRetry} className="flex-1"><RefreshCw className="size-4" />Try again</Button>
        <Button variant="outline" onClick={() => void logout()}><KeyRound className="size-4" />Sign out</Button>
      </div>
      <BackToPreview />
    </Frame>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-primary" />{label}</div>
    </div>
  );
}

/** Protects the whole app in Production Mode. Preview passes straight through. */
export function ProductionGate({ children }: { children: ReactNode }) {
  const { mode, modeReady, status } = useAuth();
  const { dataStatus, dataError, reload } = useFinance();
  if (!modeReady) return <Loading label="Opening Money Hub…" />;
  if (mode === "preview") return <>{children}</>;
  if (status !== "signed_in") return <LoginScreen expired={status === "expired"} />;
  if (dataStatus === "error") return <ConnectionError error={dataError} onRetry={reload} />;
  if (dataStatus !== "ready") return <Loading label="Loading your finances…" />;
  return <>{children}</>;
}
