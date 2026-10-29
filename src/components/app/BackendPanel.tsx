import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, PlugZap, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, Pill } from "@/components/app/ui-bits";
import { useAuth } from "@/lib/auth/session";
import { envApiUrl, getApiBaseUrl, isValidApiUrl, normalizeUrl, setApiBaseUrl } from "@/lib/api/config";
import { healthApi } from "@/lib/api/services";

export function BackendPanel() {
  const { mode, setMode } = useAuth();
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");
  useEffect(() => setUrl(getApiBaseUrl()), []);

  const valid = isValidApiUrl(normalizeUrl(url));
  const save = () => {
    if (url && !valid) return toast.error("Use an https:// address (http only for localhost).");
    setApiBaseUrl(url);
    toast.success(url ? "Server address saved" : "Using the default server address");
  };
  const test = async () => {
    if (!valid) return toast.error("Enter a valid server address first.");
    setCheck("busy");
    try {
      const r = await healthApi.check(normalizeUrl(url));
      setCheck(r.ok ? "ok" : "fail");
      setMsg(r.ok ? `Connected · v${r.version}` : "Server responded but isn't healthy");
    } catch (e) {
      setCheck("fail");
      setMsg(e instanceof Error ? e.message : "Couldn't connect");
    }
  };

  return (
    <Panel title="App mode & server" className="lg:col-span-2" action={<Pill tone={mode === "production" ? "positive" : "warning"}>{mode === "production" ? "Production" : "Preview"}</Pill>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => setMode("preview")} aria-pressed={mode === "preview"} className={`rounded-2xl border p-4 text-left transition-colors ${mode === "preview" ? "border-primary bg-primary-soft" : "hover:border-primary/50"}`}>
          <div className="text-sm font-semibold">Preview</div>
          <div className="mt-1 text-xs text-muted-foreground">Fictional demo data saved in this browser. No sign-in.</div>
        </button>
        <button onClick={() => { if (!getApiBaseUrl()) return toast.error("Save a server address first."); setMode("production"); }} aria-pressed={mode === "production"} className={`rounded-2xl border p-4 text-left transition-colors ${mode === "production" ? "border-primary bg-primary-soft" : "hover:border-primary/50"}`}>
          <div className="text-sm font-semibold">Production</div>
          <div className="mt-1 text-xs text-muted-foreground">Your real data from your Money Hub server. Sign-in required. Demo data is never shown.</div>
        </button>
      </div>
      <div className="mt-4">
        <Label htmlFor="api-url">Server address</Label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input id="api-url" placeholder={envApiUrl() || "https://api.yourdomain.com"} value={url} onChange={(e) => { setUrl(e.target.value); setCheck("idle"); }} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={test} disabled={check === "busy"}>{check === "busy" ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}Test</Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
        {check === "ok" && <p className="mt-2 flex items-center gap-1.5 text-xs text-positive"><CheckCircle2 className="size-4" />{msg}</p>}
        {check === "fail" && <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive"><XCircle className="size-4" />{msg}</p>}
      </div>
    </Panel>
  );
}
