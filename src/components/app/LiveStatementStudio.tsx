import { useState } from "react";
import { Check, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, Pill } from "@/components/app/ui-bits";
import { useFinance } from "@/lib/finance/store";
import { statementsApi } from "@/lib/api/services";
import type { ReviewItem, StatementImport } from "@/lib/api/contracts";
import { inr } from "@/lib/finance/format";

/** Production statement flow: file goes to the backend, which runs extraction + AI (OpenRouter) server-side. */
export function LiveStatementStudio() {
  const f = useFinance();
  const [account, setAccount] = useState(f.accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [imp, setImp] = useState<StatementImport | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "accept" | "skip">>({});
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    const acc = f.accounts.find((a) => a.id === account);
    if (!file || !acc) return toast.error("Choose an account and a statement file.");
    setBusy(true);
    try {
      const r = await statementsApi.upload(file, acc.id, acc.workspace);
      setImp(r);
      if (r.status === "needs_review") await loadReview(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (!imp) return;
    setBusy(true);
    try {
      const r = await statementsApi.get(imp.id);
      setImp(r);
      if (r.status === "needs_review") await loadReview(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't refresh");
    } finally {
      setBusy(false);
    }
  };
  const loadReview = async (id: string) => {
    const list = await statementsApi.review(id);
    setItems(list);
    setDecisions(Object.fromEntries(list.map((i) => [i.id, i.duplicate === "exact" ? "skip" : "accept"])));
  };
  const save = async () => {
    if (!imp) return;
    setBusy(true);
    try {
      const r = await statementsApi.decide(imp.id, Object.entries(decisions).map(([id, decision]) => ({ id, decision })));
      toast.success(`${r.created} saved · ${r.skipped} skipped`);
      setItems([]);
      setImp(null);
      setFile(null);
      f.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Panel title="Upload a statement" action={<Pill tone="positive">Processed on your server</Pill>}>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger aria-label="Account"><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>{f.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 truncate rounded-xl border px-3 py-2 text-sm">
            <FileUp className="size-4 shrink-0 text-primary" /><span className="truncate">{file?.name ?? "Choose PDF, CSV or image"}</span>
            <input type="file" className="sr-only" accept=".pdf,.csv,.xlsx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button onClick={upload} disabled={busy || !file}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Upload</Button>
        </div>
        {imp && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{imp.fileName}</span><Pill tone={imp.status === "failed" ? "negative" : "info"}>{imp.status.replace("_", " ")}</Pill>
            {imp.error && <span className="text-destructive">{imp.error}</span>}
            {(imp.status === "uploaded" || imp.status === "processing") && <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>Check progress</Button>}
          </div>
        )}
      </Panel>
      {items.length > 0 && (
        <Panel title={`Review ${items.length} transactions`} action={<Button size="sm" onClick={save} disabled={busy}>Save decisions</Button>}>
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.proposed.merchant || i.proposed.description}</div><div className="text-xs text-muted-foreground">{i.proposed.date} · {i.proposed.category} · {Math.round(i.confidence * 100)}% sure{i.reason ? ` · ${i.reason}` : ""}</div></div>
                {i.duplicate !== "none" && <Pill tone="warning">{i.duplicate === "exact" ? "Already imported" : "Possible duplicate"}</Pill>}
                <span className="num font-semibold">{inr(i.proposed.amount)}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant={decisions[i.id] === "accept" ? "default" : "outline"} aria-label="Keep" onClick={() => setDecisions((d) => ({ ...d, [i.id]: "accept" }))}><Check className="size-4" /></Button>
                  <Button size="icon" variant={decisions[i.id] === "skip" ? "default" : "outline"} aria-label="Skip" onClick={() => setDecisions((d) => ({ ...d, [i.id]: "skip" }))}><X className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
