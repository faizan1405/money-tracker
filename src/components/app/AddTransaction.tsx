import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinance } from "@/lib/finance/store";
import { BUSINESS_CATEGORIES, INCOME_CATEGORIES, PERSONAL_CATEGORIES, PROJECTS, SYSTEM_CATEGORIES } from "@/lib/finance/data";
import type { Draft, Transaction, TxnType, WorkspaceId } from "@/lib/finance/types";
import { TYPE_LABEL } from "./ui-bits";

const TYPES = Object.keys(TYPE_LABEL) as TxnType[];

function localInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

const KEYWORDS: [RegExp, string][] = [
  [/food|lunch|dinner|swiggy|zomato|coffee|chai/i, "Food & Dining"],
  [/grocer|bigbasket|zepto|blinkit|dmart/i, "Groceries"],
  [/uber|ola|auto|petrol|cab|metro|rapido/i, "Transport"],
  [/movie|netflix|show/i, "Entertainment"],
  [/rent/i, "Rent"],
  [/medicine|doctor|pharmacy/i, "Health"],
  [/meta|facebook ads|fb ads/i, "Meta Ads"],
  [/hosting|domain|hostinger/i, "Hosting & Domains"],
  [/shop|amazon|myntra|clothes/i, "Shopping"],
  [/electric|wifi|bill|recharge/i, "Bills & Utilities"],
];

/** Simple pattern-based parser for the preview. Not AI. */
export function parseQuick(text: string): Draft<Transaction> | null {
  const amt = text.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (!amt) return null;
  const amount = Number((amt[1] ?? "0").replace(/,/g, ""));
  const isIncome = /received|got|earned|salary|paid me|credited/i.test(text);
  const cat = KEYWORDS.find(([r]) => r.test(text))?.[1];
  const biz = cat === "Meta Ads" || cat === "Hosting & Domains" || /business|client|scale ?flow/i.test(text);
  const on = text.match(/(?:on|for|at)\s+([a-z][\w\s&]*)$/i)?.[1]?.trim();
  return {
    amount,
    type: isIncome ? "income" : "expense",
    category: isIncome ? (biz ? "Client Payment" : "Other Income") : cat ?? (biz ? "Other Business Expenses" : "Other"),
    workspace: biz ? "scaleflow" : "personal",
    merchant: on ? on.replace(/\b\w/g, (c) => c.toUpperCase()) : cat ?? "Quick entry",
    description: text,
    accountId: biz ? "kotak-biz" : "gpay",
  };
}

export function AddTransactionDialog() {
  const { addOpen, closeAdd, prefill, editing, addTxn, updateTxn, deleteTxns, accounts, customCategories, txns, mode } = useFinance();
  const blank = (): Draft<Transaction> => {
    const p = loadPrefs();
    return { type: "expense", workspace: p.workspace ?? "personal", accountId: p.accountId ?? "gpay", category: p.workspace === "scaleflow" ? "Meta Ads" : "Food & Dining", date: new Date().toISOString(), status: "cleared" };
  };
  const [more, setMore] = useState(false);
  const [f, setF] = useState<Draft<Transaction>>(blank);
  const [quick, setQuick] = useState("");

  useEffect(() => {
    if (addOpen) {
      setF(editing ? { ...editing } : { ...blank(), ...prefill });
      setQuick("");
      setMore(!!editing && !!(editing.notes || editing.subcategory || editing.project || editing.status === "pending"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen]);

  const set = <K extends keyof Transaction>(k: K, v: Transaction[K]) => setF((s) => ({ ...s, [k]: v }));
  const isBiz = f.workspace === "scaleflow";
  const twoAccounts = f.type === "transfer" || f.type === "cc_payment";
  const cats =
    f.type === "income" ? INCOME_CATEGORIES
      : f.type === "expense" || f.type === "refund" ? [...(isBiz ? BUSINESS_CATEGORIES : PERSONAL_CATEGORIES), ...customCategories]
        : SYSTEM_CATEGORIES;

  const recent = [...new Set(txns.filter((t) => t.type === f.type && t.workspace === f.workspace).slice(0, 60).map((t) => t.category))].filter((c) => cats.includes(c));
  const quickCats = [...new Set([...recent, ...cats])].slice(0, 8);
  const accName = accounts.find((a) => a.id === f.accountId)?.name;

  const onType = (type: TxnType) => {
    const defaults: Partial<Record<TxnType, string>> = {
      income: isBiz ? "Client Payment" : "Salary", transfer: "Transfer", cc_payment: "Card Payment", loan_disbursement: "Loan",
      loan_repayment: "Loan", adjustment: "Adjustment", expense: isBiz ? "Meta Ads" : "Food & Dining", refund: "Shopping",
    };
    setF((s) => ({ ...s, type, category: defaults[type], toAccountId: type === "cc_payment" ? "icici-cc" : s.toAccountId }));
  };

  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (!f.amount || !Number.isFinite(f.amount) || f.amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    if (f.amount > 1e10) { toast.error("That amount looks too large — please check it"); return; }
    if (!f.accountId || !accounts.some((a) => a.id === f.accountId)) { toast.error("Choose an account"); return; }
    if (f.type === "loan_repayment" && (f.interest ?? 0) > f.amount) { toast.error("Interest can't be more than the repayment amount"); return; }
    if (!f.date || Number.isNaN(new Date(f.date).getTime())) { toast.error("Choose a valid date"); return; }
    if (twoAccounts && (!f.toAccountId || f.toAccountId === f.accountId)) { toast.error("Choose two different accounts"); return; }
    const t = {
      ...f,
      amount: Math.round(f.amount * 100) / 100,
      merchant: f.merchant?.trim() || f.category || "Untitled",
      description: f.description || f.merchant?.trim() || f.category || "",
      category: f.category ?? "Other",
      toAccountId: twoAccounts ? f.toAccountId : undefined,
      source: f.source ?? "manual",
    } as Omit<Transaction, "id">;
    setBusy(true);
    try {
      if (editing) {
        if (!(await updateTxn(editing.id, t))) return; // error already shown; dialog stays open
        toast.success("Transaction updated");
      } else {
        if (!(await addTxn(t))) return;
        savePrefs({ accountId: t.accountId, workspace: t.workspace });
        toast.success(t.merchant === t.category ? `Added ${t.category}` : `Added ${t.merchant} · ${t.category}`);
      }
      closeAdd();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={addOpen} onOpenChange={(o) => !o && closeAdd()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">{editing ? "Edit transaction" : "Add transaction"}</DialogTitle>
          <DialogDescription>Saved to this browser only (Preview Mode).</DialogDescription>
        </DialogHeader>

        {!editing && (
          <div className="rounded-xl border border-dashed bg-secondary/50 p-3">
            <Label htmlFor="quick" className="text-xs text-muted-foreground">Quick entry — pattern matching preview, not AI</Label>
            <div className="mt-1.5 flex gap-2">
              <Input id="quick" placeholder='e.g. "Spent 450 on food"' value={quick} onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("quick-btn")?.click()} />
              <Button id="quick-btn" variant="secondary" onClick={() => {
                const p = parseQuick(quick);
                if (!p) { toast.error("Couldn't find an amount in that text"); return; }
                setF((s) => ({ ...s, ...p }));
                toast("Fields filled — review before saving");
              }}><Wand2 className="size-4" />Fill</Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="amt">Amount (₹)</Label>
            <Input id="amt" autoFocus={!editing} inputMode="decimal" enterKeyHint="done" className="num mt-1.5 h-14 text-2xl font-semibold" placeholder="0"
              value={f.amount ?? ""}
              onKeyDown={(e) => e.key === "Enter" && save()}
              onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); set("amount", v === "" ? (undefined as unknown as number) : Number(v)); }} />
          </div>
          {quickCats.length > 0 && (
            <div className="sm:col-span-2">
              <Label>Category</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Quick categories">
                {quickCats.map((c) => (
                  <button key={c} type="button" onClick={() => set("category", c)} aria-pressed={f.category === c}
                    className={cn("min-h-9 rounded-full border px-3 text-xs font-medium transition-colors", f.category === c ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary")}>{c}</button>
                ))}
              </div>
            </div>
          )}
          <Field label="Type">
            <Select value={f.type ?? ""} onValueChange={(v) => onType(v as TxnType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={twoAccounts ? "From account" : "Account"}>
            <Select value={f.accountId ?? ""} onValueChange={(v) => set("accountId", v)}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {twoAccounts && (
            <Field label={f.type === "cc_payment" ? "Card being paid" : "To account"}>
              <Select value={f.toAccountId ?? ""} onValueChange={(v) => set("toAccountId", v)}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => (f.type === "cc_payment" ? a.kind === "credit_card" : a.id !== f.accountId)).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {f.type === "loan_repayment" && (
            <Field label="Interest portion (₹)">
              <Input inputMode="decimal" value={f.interest ?? ""} onChange={(e) => set("interest", Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
            </Field>
          )}
          {f.type === "adjustment" && (
            <Field label="Direction">
              <Select value={String(f.adjustmentSign ?? 1)} onValueChange={(v) => set("adjustmentSign", Number(v) as 1 | -1)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">Increase balance</SelectItem><SelectItem value="-1">Decrease balance</SelectItem></SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Merchant / recipient (optional)">
            <Input value={f.merchant ?? ""} onChange={(e) => set("merchant", e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={f.category ? `Defaults to “${f.category}”` : "Swiggy, Hostinger…"} />
          </Field>

          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex min-h-10 items-center justify-between rounded-xl border border-dashed px-3 text-sm text-muted-foreground hover:text-foreground sm:col-span-2">
            <span>More details <span className="text-xs">· {f.workspace === "scaleflow" ? "Scale Flow" : "Personal"} · {f.date ? new Date(f.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}{accName ? ` · ${accName}` : ""}</span></span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", more && "rotate-180")} />
          </button>

          {more && (
            <>
              <Field label="Workspace">
                <Select value={f.workspace ?? ""} onValueChange={(v) => setF((s) => ({ ...s, workspace: v as WorkspaceId }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="personal">Personal</SelectItem><SelectItem value="scaleflow">Business: Scale Flow</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Date & time">
                <Input type="datetime-local" value={f.date ? localInput(f.date) : ""} onChange={(e) => e.target.value && set("date", new Date(e.target.value).toISOString())} />
              </Field>
              <Field label="All categories">
                <Select value={f.category ?? ""} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{[...new Set([...(f.category ? [f.category] : []), ...cats])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Subcategory">
                <Input value={f.subcategory ?? ""} onChange={(e) => set("subcategory", e.target.value)} />
              </Field>
              {isBiz && mode === "preview" && (
                <Field label="Client / project">
                  <Select value={f.project ?? "none"} onValueChange={(v) => {
                    const p = PROJECTS.find((x) => x.name === v);
                    setF((s) => ({ ...s, project: p?.name, client: p?.client }));
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">None</SelectItem>{PROJECTS.map((p) => <SelectItem key={p.id} value={p.name}>{p.client} — {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Status">
                <Select value={f.status ?? ""} onValueChange={(v) => set("status", v as Transaction["status"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="cleared">Cleared</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Textarea className="mt-1.5" rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground sm:col-span-2">
                Receipt attachments will be available once private file storage is connected.
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between gap-2 border-t bg-background px-6 py-3">
          {editing ? (
            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { setBusy(true); const ok = await deleteTxns([editing.id]); setBusy(false); if (ok) { toast("Transaction deleted"); closeAdd(); } }}>
              <Trash2 className="size-4" />Delete
            </Button>
          ) : <span />}
          <div className="flex flex-1 justify-end gap-2">
            <Button variant="outline" onClick={closeAdd}>Cancel</Button>
            <Button onClick={save} disabled={busy} className="min-w-32 flex-1 sm:flex-none">{busy ? "Saving…" : editing ? "Save changes" : "Add transaction"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const PREFS = "moneyhub-preview-v1-prefs";
function loadPrefs(): { accountId?: string; workspace?: WorkspaceId } {
  try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; }
}
function savePrefs(p: { accountId: string; workspace: WorkspaceId }) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
