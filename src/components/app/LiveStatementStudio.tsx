import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2, Lock, Pencil, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, Pill } from "@/components/app/ui-bits";
import { useFinance } from "@/lib/finance/store";
import { statementsApi } from "@/lib/api/services";
import { ApiError } from "@/lib/api/client";
import type { ReviewEdit, ReviewItem, StatementImport } from "@/lib/api/contracts";
import { BUSINESS_CATEGORIES, INCOME_CATEGORIES, PERSONAL_CATEGORIES, SYSTEM_CATEGORIES, WORKSPACES } from "@/lib/finance/data";
import { formatINRExact as inr } from "@/lib/finance/format";

const TYPES = [
  ["expense", "Money out (expense)"], ["income", "Money in (income)"], ["refund", "Refund"], ["transfer", "Transfer between my accounts"],
  ["cc_payment", "Credit card bill payment"], ["loan_repayment", "Loan / EMI payment"], ["loan_disbursement", "Loan received"],
] as const;
const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

/** Production statement flow: the server parses the file, applies your rules, asks AI (if set up) for categories; you approve. */
export function LiveStatementStudio() {
  const f = useFinance();
  const [account, setAccount] = useState(f.accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [imp, setImp] = useState<StatementImport | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, ReviewEdit & { remember?: boolean }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "flagged">("all");
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => [...new Set([...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES, ...INCOME_CATEGORIES, ...SYSTEM_CATEGORIES, "Cash Withdrawal", "Bank Charges", ...f.customCategories])], [f.customCategories]);

  const upload = async () => {
    const acc = f.accounts.find((a) => a.id === account);
    if (!file || !acc) return void toast.error("Choose an account and a statement file.");
    setBusy(true);
    try {
      const r = await statementsApi.upload(file, acc.id, acc.workspace, password || undefined);
      setPassword("");
      setNeedsPassword(false);
      setImp(r);
      if (r.status === "needs_review") {
        const list = await statementsApi.review(r.id);
        setItems(list);
        setEdits({});
        // Pre-select confident, non-duplicate rows; anything flagged waits for you.
        setPicked(Object.fromEntries(list.map((i) => [i.id, i.duplicate === "none" && i.flags.length === 0])));
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === "password_required" || code === "bad_password") setNeedsPassword(true);
      setPassword("");
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const edit = (id: string, patch: ReviewEdit & { remember?: boolean }) => setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const eff = (i: ReviewItem) => ({ ...i.proposed, ...edits[i.id] });

  const save = async () => {
    if (!imp) return;
    const decisions = items.map((i) => {
      const { remember, ...e } = edits[i.id] ?? {};
      const accept = !!picked[i.id] && i.duplicate !== "exact";
      return { id: i.id, decision: accept ? ("accept" as const) : ("skip" as const), ...(accept && Object.keys(e).length ? { edited: e } : {}), ...(accept && remember ? { remember } : {}) };
    });
    const missing = items.find((i) => picked[i.id] && ["transfer", "cc_payment"].includes(eff(i).type) && !edits[i.id]?.otherAccountId);
    if (missing) { setOpen(missing.id); return void toast.error(`Row ${missing.line}: choose the other account for this transfer.`); }
    setBusy(true);
    try {
      const r = await statementsApi.decide(imp.id, decisions);
      toast.success(`${r.created} saved · ${r.skipped} skipped${r.rulesLearned ? ` · ${r.rulesLearned} rule${r.rulesLearned > 1 ? "s" : ""} learned` : ""}`);
      setItems([]); setImp(null); setFile(null); setEdits({}); setPicked({});
      f.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!imp) return;
    setBusy(true);
    try { await statementsApi.discard(imp.id); setItems([]); setImp(null); setFile(null); toast.success("Statement discarded — nothing was saved."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't discard"); }
    finally { setBusy(false); }
  };

  const s = imp?.summary;
  const rec = s?.reconciliation;
  const shown = filter === "flagged" ? items.filter((i) => i.flags.length || i.duplicate !== "none") : items;
  const selected = items.filter((i) => picked[i.id] && i.duplicate !== "exact").length;
  const acc = f.accounts.find((a) => a.id === (imp?.accountId ?? account));

  return (
    <div className="grid gap-4">
      <Panel title="Upload a statement" action={<Pill tone="positive"><ShieldCheck className="size-3" />Processed on your server</Pill>}>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger aria-label="Account"><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>{f.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 truncate rounded-xl border px-3 py-2 text-sm">
            <FileUp className="size-4 shrink-0 text-primary" /><span className="truncate">{file?.name ?? "Choose PDF or CSV"}</span>
            <input type="file" className="sr-only" accept=".pdf,.csv,text/csv,application/pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setNeedsPassword(false); }} />
          </label>
          <Button onClick={upload} disabled={busy || !file || !!imp}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Read statement</Button>
        </div>
        {needsPassword && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Lock className="size-4 text-warning" />
            <Input type="password" autoComplete="off" className="max-w-xs" placeholder="PDF password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="PDF password" />
            <span className="text-xs text-muted-foreground">Used once to open the file. Never saved.</span>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Text PDFs and CSVs are supported. Scanned statements (photos/images inside a PDF) aren't read yet. Amounts, dates and balances are always read directly from the file — AI only suggests categories.</p>
      </Panel>

      {imp && s && (
        <Panel title={imp.fileName} action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={discard} disabled={busy}>Discard</Button></div>}>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Account" value={`${acc?.name ?? "—"}${s.accountLast4 ? ` · ending ${s.accountLast4}` : ""}`} />
            <Fact label="Period" value={s.period ? `${s.period.from} → ${s.period.to}` : "—"} />
            <Fact label="Transactions found" value={`${s.found} · ${s.duplicates} duplicate · ${s.flagged} to check`} />
            <Fact label="AI" value={s.ai.status === "used" ? `Used (${s.ai.model})${s.ai.costUsd ? ` · $${s.ai.costUsd.toFixed(4)}` : ""}` : s.ai.status === "not_needed" ? "Not needed — your rules covered it" : s.ai.status === "not_configured" ? "Not set up" : "Failed"} />
          </div>
          {rec && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Pill tone={rec.status === "balanced" ? "positive" : rec.status === "mismatch" ? "negative" : "warning"}>
                {rec.status === "balanced" ? "Balances match" : rec.status === "mismatch" ? "Balances don't match" : rec.status === "unclear" ? "Some directions unclear" : "No opening/closing balance"}
              </Pill>
              {rec.opening !== undefined && <span className="num">Opening {inr(rec.opening)}</span>}
              <span className="num text-positive">+{inr(rec.credits)}</span>
              <span className="num text-negative">−{inr(rec.debits)}</span>
              {rec.closing !== undefined && <span className="num">Closing {inr(rec.closing)}</span>}
              {rec.difference ? <span className="num text-destructive">Off by {inr(rec.difference)}</span> : null}
            </div>
          )}
          {[...(s.ai.message ? [s.ai.message] : []), ...s.warnings].map((w) => (
            <p key={w} className="mt-2 flex items-start gap-2 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</p>
          ))}
        </Panel>
      )}

      {items.length > 0 && (
        <Panel
          title={`Review ${items.length} rows`}
          action={<div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setFilter(filter === "all" ? "flagged" : "all")}>{filter === "all" ? "Show only to check" : "Show all"}</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Save {selected} selected</Button>
          </div>}
        >
          <ul className="divide-y">
            {shown.map((i) => {
              const e = eff(i);
              const exact = i.duplicate === "exact";
              const transferish = e.type === "transfer" || e.type === "cc_payment";
              return (
                <li key={i.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-start gap-3">
                    <Checkbox className="mt-1" checked={!!picked[i.id] && !exact} disabled={exact} onCheckedChange={(v) => setPicked((p) => ({ ...p, [i.id]: !!v }))} aria-label={`Approve row ${i.line}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.merchant || i.description}</div>
                      <div className="truncate text-xs text-muted-foreground">{i.description}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <span>{i.date}{i.time ? ` ${i.time}` : ""}</span>
                        <span>· {typeLabel(e.type)}</span>
                        <span>· {e.category}</span>
                        <span>· {WORKSPACES.find((w) => w.id === e.workspace)?.short ?? e.workspace}</span>
                        {i.source !== "none" && <span>· {i.source === "rule" ? "your rule" : `AI ${Math.round(i.confidence * 100)}% sure`}</span>}
                        {i.ref && <span>· Ref {i.ref}</span>}
                      </div>
                      {i.reason && <div className="mt-1 text-xs italic text-muted-foreground">{i.reason}</div>}
                      {(i.flags.length > 0 || i.duplicate !== "none") && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {exact && <Pill tone="neutral">Already imported</Pill>}
                          {i.flags.map((fl) => <Pill key={fl} tone="warning">{fl}</Pill>)}
                        </div>
                      )}
                    </div>
                    <span className={`num font-semibold ${i.direction === "credit" ? "text-positive" : ""}`}>{i.direction === "credit" ? "+" : i.direction === "debit" ? "−" : "?"}{inr(i.amount)}</span>
                    {!exact && <Button size="icon" variant="ghost" aria-label={`Edit row ${i.line}`} onClick={() => setOpen(open === i.id ? null : i.id)}><Pencil className="size-4" /></Button>}
                  </div>
                  {open === i.id && !exact && (
                    <div className="mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Select value={e.type} onValueChange={(v) => edit(i.id, { type: v as NonNullable<ReviewEdit["type"]> })}>
                        <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={e.category} onValueChange={(v) => edit(i.id, { category: v })}>
                        <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                        <SelectContent>{[...new Set([e.category, ...categories])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={e.workspace} onValueChange={(v) => edit(i.id, { workspace: v })}>
                        <SelectTrigger aria-label="Workspace"><SelectValue /></SelectTrigger>
                        <SelectContent>{WORKSPACES.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input value={e.merchant} onChange={(ev) => edit(i.id, { merchant: ev.target.value })} placeholder="Merchant / person" aria-label="Merchant" />
                      {transferish && (
                        <Select value={edits[i.id]?.otherAccountId ?? ""} onValueChange={(v) => edit(i.id, { otherAccountId: v })}>
                          <SelectTrigger aria-label="Other account"><SelectValue placeholder={i.direction === "credit" ? "Money came from…" : "Money went to…"} /></SelectTrigger>
                          <SelectContent>{f.accounts.filter((a) => a.id !== imp?.accountId && (e.type !== "cc_payment" || i.direction === "credit" || a.kind === "credit_card")).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {e.type === "loan_repayment" && (
                        <Input type="number" min={0} step="0.01" placeholder="Interest part (optional, from loan statement)" aria-label="Interest"
                          onChange={(ev) => setEdits((m) => { const { interest: _drop, ...rest } = m[i.id] ?? {}; return { ...m, [i.id]: ev.target.value === "" ? rest : { ...rest, interest: Number(ev.target.value) } }; })} />
                      )}
                      <label className="flex items-center gap-2 text-xs sm:col-span-2 lg:col-span-3">
                        <Checkbox checked={!!edits[i.id]?.remember} onCheckedChange={(v) => edit(i.id, { remember: !!v })} />
                        Remember this category for “{e.merchant || "this merchant"}” next time
                      </label>
                      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                        <Button size="sm" onClick={() => { setPicked((p) => ({ ...p, [i.id]: true })); setOpen(null); }}><Check className="size-4" />Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => { setPicked((p) => ({ ...p, [i.id]: false })); setOpen(null); }}><X className="size-4" />Reject</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="truncate font-medium">{value}</div></div>;
}
