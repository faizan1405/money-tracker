import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCheck, Copy, FileScan, FileText, Info, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinance } from "@/lib/finance/store";
import { dedupe, matchDuplicate } from "@/lib/finance/calc";
import { buildSampleStatement, BUSINESS_CATEGORIES, INCOME_CATEGORIES, PERSONAL_CATEGORIES, SYSTEM_CATEGORIES, type StatementRow } from "@/lib/finance/data";
import { formatDate, formatINR } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/types";
import { PageHeader, Panel, Pill } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/statement-studio")({
  head: () => ({
    meta: [
      { title: "AI Statement Studio — Money Hub AI" },
      { name: "description", content: "Review statement transactions before they enter your ledger." },
      { property: "og:title", content: "AI Statement Studio — Money Hub AI" },
      { property: "og:description", content: "Review statement transactions before they enter your ledger." },
    ],
  }),
  component: Studio,
});

const STEPS = ["Upload", "Text / OCR extraction", "Transaction detection", "Categorisation", "Duplicate checks", "Reconciliation", "Your review", "Save"];
const CATS = [...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES, ...INCOME_CATEGORIES, ...SYSTEM_CATEGORIES];

function Studio() {
  const f = useFinance();
  const [account, setAccount] = useState("hdfc");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState(-1);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);

  const runSample = () => {
    setFile(null);
    setRows([]);
    setStep(0);
    let i = 0;
    const tick = () => {
      i++;
      setStep(i);
      if (i < 6) setTimeout(tick, 450);
      else setRows(buildSampleStatement());
    };
    setTimeout(tick, 450);
  };

  const pick = (fl?: File | null) => {
    if (!fl) return;
    setFile(fl);
    setStep(-1);
    setRows([]);
  };

  const setRow = (id: string, patch: Partial<StatementRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const pending = rows.filter((r) => r.state === "pending");
  const approved = rows.filter((r) => r.state === "approved");

  const toTxn = (r: StatementRow): Omit<Transaction, "id"> => {
    const isTransfer = r.category === "Transfer";
    const type: Transaction["type"] = isTransfer ? "transfer" : r.category === "Refund" ? "refund" : r.direction === "credit" ? "income" : "expense";
    return {
      type, amount: r.amount, merchant: r.merchant, description: r.description, category: r.category === "Refund" ? "Shopping" : r.category,
      workspace: r.workspace, accountId: r.workspace === "scaleflow" && account === "hdfc" ? "kotak-biz" : account,
      toAccountId: isTransfer ? (account === "kotak-biz" ? "hdfc" : "kotak-biz") : undefined,
      date: r.date, status: "cleared", source: "statement", ref: r.ref,
    };
  };
  const ledgerMatch = (r: StatementRow) => matchDuplicate(toTxn(r), f.txns);

  const commit = () => {
    const ts = approved.map(toTxn);
    const { fresh, skipped } = dedupe(ts, f.txns);
    if (fresh.length) f.addTxns(fresh);
    if (!fresh.length) toast.error("All approved rows were already imported (same bank reference) — nothing was added");
    else toast.success(`${fresh.length} sample transactions added${skipped ? ` · ${skipped} already imported, skipped` : ""}`);
    setRows([]);
    setStep(-1);
    setSel(new Set());
  };

  return (
    <>
      <PageHeader title="AI Statement Studio" subtitle="Turn statements into reviewed, categorised transactions. Nothing enters your ledger without your approval." />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-colors", drag ? "border-primary bg-primary-soft" : "bg-secondary/40")}
          >
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-card shadow-card"><Upload className="size-6 text-primary" /></span>
            <p className="mt-4 font-display text-xl">Drop a statement here</p>
            <p className="mt-1 text-sm text-muted-foreground">Bank, credit-card or UPI statement · PDF or CSV</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => input.current?.click()}><FileText className="size-4" />Choose file</Button>
              <Button onClick={runSample}><Sparkles className="size-4" />Try Sample Statement</Button>
            </div>
            <input ref={input} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Statement account</span>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="w-full max-w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>{f.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {file && (
            <div className="mt-4 flex gap-3 rounded-xl border bg-info-soft p-4 text-sm text-info">
              <Info className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>
                <p className="mt-1">This file has <b>not</b> been analysed. Live statement reading will be switched on once the secure backend is connected. Your file stayed in this browser and was not uploaded anywhere.</p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Processing pipeline">
          {step >= 0 && <div className="mb-3"><Pill tone="info">Demonstration — sample data</Pill></div>}
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => {
              const done = step > i || (rows.length > 0 && i <= 5);
              const now = step === i && !rows.length;
              const review = rows.length > 0 && i === 6;
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className={cn("grid size-6 place-items-center rounded-full border text-[11px] font-semibold", done && "border-positive bg-positive text-primary-foreground", (now || review) && "border-primary text-primary")}>
                    {done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn(!done && !now && !review && "text-muted-foreground")}>{s}</span>
                  {now && <span className="ml-auto text-xs text-primary">working…</span>}
                  {review && <span className="ml-auto text-xs text-primary">{pending.length} left</span>}
                </li>
              );
            })}
          </ol>
          {step >= 0 && !rows.length && (
            <div className="relative mt-4 h-24 overflow-hidden rounded-xl border bg-secondary/50">
              <div className="absolute inset-x-0 h-6 bg-primary-soft scan-line" />
              <FileScan className="absolute inset-0 m-auto size-8 text-primary" />
            </div>
          )}
        </Panel>
      </div>

      {rows.length > 0 && (
        <Panel className="mt-4" title="Review suggested transactions" action={<Pill tone="warning">Sample — not from a real statement</Pill>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRows((r) => r.map((x) => (x.state === "pending" && !x.duplicateOf && ledgerMatch(x) === "none" && x.confidence >= 0.8 ? { ...x, state: "approved" } : x)))}><CheckCheck className="size-4" />Approve all high-confidence</Button>
            {sel.size > 0 && (
              <>
                <Select onValueChange={(c) => { sel.forEach((id) => setRow(id, { category: c })); setSel(new Set()); }}>
                  <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder={`Set category (${sel.size})`} /></SelectTrigger>
                  <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => { sel.forEach((id) => setRow(id, { state: "approved" })); setSel(new Set()); }}>Approve selected</Button>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{approved.length} approved</span>
              <Button size="sm" disabled={!approved.length || pending.length > 0} onClick={commit}>Save to ledger</Button>
            </div>
          </div>
          {pending.length > 0 && approved.length > 0 && <p className="mb-2 text-xs text-muted-foreground">Approve or reject every row to save.</p>}
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className={cn("grid grid-cols-[auto_1fr] gap-3 py-3 sm:grid-cols-[auto_1.4fr_1fr_auto] sm:items-center", r.state === "rejected" && "opacity-45")}>
                <Checkbox checked={sel.has(r.id)} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-label={`Select ${r.merchant}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{r.merchant}</span>
                    <span className={cn("num text-sm font-semibold", r.direction === "credit" && "text-positive")}>{r.direction === "credit" ? "+" : "−"}{formatINR(r.amount)}</span>
                    {ledgerMatch(r) === "exact" && <Pill tone="negative"><Copy className="size-3" />Already imported — will be skipped</Pill>}
                    {ledgerMatch(r) === "possible" && <Pill tone="warning"><Copy className="size-3" />Similar entry in ledger — check</Pill>}
                    {r.duplicateOf && <Pill tone="negative"><Copy className="size-3" />Duplicate?</Pill>}
                    {r.flag && !r.duplicateOf && ledgerMatch(r) === "none" && <Pill tone="warning"><AlertTriangle className="size-3" />{r.flag}</Pill>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{formatDate(r.date)} · {r.description}</div>
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
                  <Select value={r.category} onValueChange={(c) => setRow(r.id, { category: c })}>
                    <SelectTrigger className="h-8 w-[170px]" aria-label="Category"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <button onClick={() => setRow(r.id, { workspace: r.workspace === "personal" ? "scaleflow" : "personal" })}><Pill tone={r.workspace === "personal" ? "info" : "primary"}>{r.workspace === "personal" ? "Personal" : "Scale Flow"}</Pill></button>
                  <div className="flex items-center gap-1.5" title="Confidence">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full", r.confidence >= 0.8 ? "bg-positive" : r.confidence >= 0.6 ? "bg-warning" : "bg-negative")} style={{ width: `${r.confidence * 100}%` }} /></div>
                    <span className="num text-[11px] text-muted-foreground">{Math.round(r.confidence * 100)}%</span>
                  </div>
                </div>
                <div className="col-span-2 flex gap-1.5 sm:col-span-1">
                  <Button size="sm" variant={r.state === "approved" ? "default" : "outline"} onClick={() => setRow(r.id, { state: r.state === "approved" ? "pending" : "approved" })} aria-label="Approve"><Check className="size-4" /></Button>
                  <Button size="sm" variant={r.state === "rejected" ? "destructive" : "outline"} onClick={() => setRow(r.id, { state: r.state === "rejected" ? "pending" : "rejected" })} aria-label="Reject"><X className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
