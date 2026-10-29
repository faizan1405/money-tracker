import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, Lock, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinance } from "@/lib/finance/store";
import { toCSV } from "@/lib/finance/calc";
import { downloadCSV } from "@/lib/finance/download";
import { BUSINESS_CATEGORIES, PERSONAL_CATEGORIES, WORKSPACES } from "@/lib/finance/data";
import type { WorkspaceId } from "@/lib/finance/types";
import { PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { BackendPanel } from "@/components/app/BackendPanel";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Money Hub AI" },
      { name: "description", content: "Profile, appearance, workspaces, categorisation rules and data." },
      { property: "og:title", content: "Settings — Money Hub AI" },
      { property: "og:description", content: "Profile, appearance, workspaces, categorisation rules and data." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const f = useFinance();
  const [match, setMatch] = useState("");
  const [cat, setCat] = useState("");
  const rules = f.rules.slice().sort((a, b) => a.priority - b.priority);
  const move = (id: string, d: -1 | 1) => {
    const i = rules.findIndex((r) => r.id === id);
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    f.update("rules", next.map((r, k) => ({ ...r, priority: k + 1 })));
  };

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs defaultValue="rules">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="rules">Categorisation rules</TabsTrigger>
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          <TabsTrigger value="data">Data & privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Profile">
            <div className="space-y-3">
              <div><Label>Name</Label><Input className="mt-1.5" defaultValue="Faizan" /></div>
              <div><Label>Default currency</Label><Input className="mt-1.5" value="INR — Indian Rupee (₹)" readOnly /></div>
              <div><Label>Time zone</Label><Input className="mt-1.5" value="Asia/Kolkata (IST)" readOnly /></div>
            </div>
          </Panel>
          <Panel title="Appearance">
            <div className="flex items-center justify-between"><div><div className="text-sm font-medium">Dark mode</div><div className="text-xs text-muted-foreground">Light is the default</div></div><Switch checked={f.dark} onCheckedChange={f.setDark} /></div>
          </Panel>
          <Panel title="Security" className="lg:col-span-2">
            <div className="flex gap-3 text-sm"><Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="text-muted-foreground">Private sign-in, two-step verification, encrypted document storage and backups will be set up with the production backend. They are not active in Preview Mode.</p></div>
          </Panel>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <Panel title="Categorisation rules" action={<Pill tone="info">Applied in order of priority</Pill>}>
            <p className="mb-4 text-sm text-muted-foreground">When a merchant or description contains the text, it's filed under that category. Future statement imports will use these rules and your corrections.</p>
            <ul className="divide-y">
              {rules.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="num w-6 text-xs text-muted-foreground">#{i + 1}</span>
                  <code className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold">{r.match}</code>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Select value={r.category} onValueChange={(c) => f.update("rules", f.rules.map((x) => (x.id === r.id ? { ...x, category: c } : x)))}>
                    <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{[...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Pill tone={r.workspace === "personal" ? "info" : "primary"}>{r.workspace === "personal" ? "Personal" : "Scale Flow"}</Pill>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => move(r.id, -1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => move(r.id, 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                    <Switch checked={r.enabled} onCheckedChange={(v) => f.update("rules", f.rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} aria-label="Enabled" />
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => f.update("rules", f.rules.filter((x) => x.id !== r.id))} aria-label="Delete rule"><Trash2 className="size-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
            <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (!match.trim() || !cat) { toast.error("Enter match text and a category"); return; }
              const ws: WorkspaceId = BUSINESS_CATEGORIES.includes(cat) ? "scaleflow" : "personal";
              f.update("rules", [...f.rules, { id: `ru${Date.now()}`, match: match.trim().toUpperCase(), category: cat, workspace: ws, priority: f.rules.length + 1, enabled: true }]);
              setMatch(""); setCat(""); toast.success("Rule added");
            }}>
              <Input className="w-48" placeholder="Merchant contains…" value={match} onChange={(e) => setMatch(e.target.value)} />
              <Select value={cat} onValueChange={setCat}><SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent>{[...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              <Button type="submit" variant="secondary"><Plus className="size-4" />Add rule</Button>
              <Button type="button" variant="outline" onClick={() => {
                const active = rules.filter((r) => r.enabled);
                let n = 0;
                f.txns.forEach((t) => {
                  const hit = active.find((r) => `${t.merchant} ${t.description}`.toUpperCase().includes(r.match));
                  if (hit && (t.type === "expense") && t.category !== hit.category) { f.updateTxn(t.id, { category: hit.category, workspace: hit.workspace }); n++; }
                });
                toast.success(n ? `Re-categorised ${n} transactions` : "Everything already matches your rules");
              }}>Apply to existing</Button>
            </form>
          </Panel>
        </TabsContent>

        <TabsContent value="workspaces" className="mt-4">
          <Panel title="Financial workspaces">
            <ul className="divide-y">{WORKSPACES.map((w) => <li key={w.id} className="flex items-center justify-between py-3 text-sm"><span className="font-medium">{w.name}</span><Pill>{w.kind}</Pill></li>)}</ul>
            <p className="mt-3 text-xs text-muted-foreground">More businesses can be added once the backend is connected. Transfers between workspaces are never counted as income or expenses.</p>
          </Panel>
        </TabsContent>

        <TabsContent value="data" className="mt-4 grid gap-4 lg:grid-cols-2">
          <BackendPanel />
          <Panel title="Export">
            <Button variant="outline" onClick={() => downloadCSV("money-hub-all.csv", toCSV(f.txns, f.accounts))}><Download className="size-4" />Download all transactions (CSV)</Button>
          </Panel>
          <Panel title="Privacy">
            <div className="flex gap-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" /><p className="text-muted-foreground">Preview data lives only in this browser's storage. It is <b>not</b> secure financial storage — please don't enter real account numbers or credentials here.</p></div>
            {f.mode === "preview" && <Button variant="outline" className="mt-4" onClick={() => { f.resetDemo(); toast.success("Demo data restored"); }}><RotateCcw className="size-4" />Reset demo data</Button>}
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
