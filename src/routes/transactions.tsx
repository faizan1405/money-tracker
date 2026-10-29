import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, Search, SlidersHorizontal, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinance, useScoped } from "@/lib/finance/store";
import { netOf, toCSV } from "@/lib/finance/calc";
import { downloadCSV } from "@/lib/finance/download";
import { formatINR } from "@/lib/finance/format";
import { BUSINESS_CATEGORIES, INCOME_CATEGORIES, PERSONAL_CATEGORIES, SYSTEM_CATEGORIES } from "@/lib/finance/data";
import type { TxnType, WorkspaceFilter } from "@/lib/finance/types";
import { EmptyState, PageHeader, Panel, TYPE_LABEL } from "@/components/app/ui-bits";
import { TxnList } from "@/components/app/TxnList";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — Money Hub AI" },
      { name: "description", content: "Search, filter, edit and categorise every transaction." },
      { property: "og:title", content: "Transactions — Money Hub AI" },
      { property: "og:description", content: "Search, filter, edit and categorise every transaction." },
    ],
  }),
  component: Transactions,
});

const ALL_CATS = [...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES, ...INCOME_CATEGORIES, ...SYSTEM_CATEGORIES];

function Transactions() {
  const { openAdd, accounts, updateTxn, deleteTxns, customCategories, workspace, setWorkspace } = useFinance();
  const { txns } = useScoped();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | TxnType>("all");
  const [cat, setCat] = useState("all");
  const [acc, setAcc] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(50);

  const list = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const fromT = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
    const toT = to ? new Date(to + "T23:59:59.999").getTime() : Infinity;
    const lo = min ? Number(min) : -Infinity;
    const hi = max ? Number(max) : Infinity;
    return txns.filter((t) => {
      const hay = `${t.merchant} ${t.description} ${t.category} ${t.subcategory ?? ""} ${t.client ?? ""} ${t.project ?? ""} ${t.notes ?? ""} ${t.amount}`.toLowerCase();
      const d = new Date(t.date).getTime();
      return (words.every((w) => hay.includes(w))) &&
      (type === "all" || t.type === type) &&
      (cat === "all" || t.category === cat) &&
      (acc === "all" || t.accountId === acc || t.toAccountId === acc) &&
      d >= fromT && d <= toT && t.amount >= lo && t.amount <= hi;
    });
  }, [txns, q, type, cat, acc, from, to, min, max]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => { setQ(""); setType("all"); setCat("all"); setAcc("all"); setFrom(""); setTo(""); setMin(""); setMax(""); setWorkspace("all"); };
  const chips: { label: string; off: () => void }[] = [
    ...(workspace !== "all" ? [{ label: workspace === "personal" ? "Personal" : "Scale Flow", off: () => setWorkspace("all") }] : []),
    ...(type !== "all" ? [{ label: TYPE_LABEL[type], off: () => setType("all") }] : []),
    ...(cat !== "all" ? [{ label: cat, off: () => setCat("all") }] : []),
    ...(acc !== "all" ? [{ label: accounts.find((a) => a.id === acc)?.name ?? acc, off: () => setAcc("all") }] : []),
    ...(from ? [{ label: `From ${from}`, off: () => setFrom("") }] : []),
    ...(to ? [{ label: `To ${to}`, off: () => setTo("") }] : []),
    ...(min ? [{ label: `≥ ₹${min}`, off: () => setMin("") }] : []),
    ...(max ? [{ label: `≤ ₹${max}`, off: () => setMax("") }] : []),
    ...(q ? [{ label: `“${q}”`, off: () => setQ("") }] : []),
  ];
  const active = chips.length - (q ? 1 : 0);
  const badRange = min && max && Number(min) > Number(max);

  return (
    <>
      <PageHeader title="Transactions" subtitle={`${list.length} of ${txns.length} transactions`} actions={<>
        <Button variant="outline" onClick={() => downloadCSV("money-hub-transactions.csv", toCSV(list, accounts))}><Download className="size-4" />CSV</Button>
        <Button onClick={() => openAdd()}><Plus className="size-4" />Add</Button>
      </>} />

      <Panel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant, description, category…" className="pl-9" />
          </div>
          <Button variant={showFilters ? "secondary" : "outline"} onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="size-4" />Filters{active > 0 && ` (${active})`}
          </Button>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={workspace} onValueChange={(v) => setWorkspace(v as WorkspaceFilter)}>
              <SelectTrigger aria-label="Workspace"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All workspaces</SelectItem><SelectItem value="personal">Personal</SelectItem><SelectItem value="scaleflow">Business: Scale Flow</SelectItem></SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All types</SelectItem>{(Object.keys(TYPE_LABEL) as TxnType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{[...ALL_CATS, ...customCategories].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={acc} onValueChange={setAcc}>
              <SelectTrigger aria-label="Account"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All accounts</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex gap-2"><Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="flex gap-2"><Input inputMode="numeric" aria-label="Minimum amount" placeholder="Min ₹" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} /><Input inputMode="numeric" aria-label="Maximum amount" placeholder="Max ₹" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} /></div>
            <Button variant="ghost" onClick={clear}><X className="size-4" />Clear filters</Button>
          </div>
        )}

        {badRange && <p className="mt-2 text-xs text-negative">Minimum amount is higher than maximum — no transactions can match.</p>}
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <button key={c.label} onClick={c.off} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs hover:border-primary" aria-label={`Remove filter ${c.label}`}>
                <span className="truncate">{c.label}</span><X className="size-3 shrink-0" />
              </button>
            ))}
            <button onClick={clear} className="px-1 text-xs font-medium text-primary hover:underline">Reset all</button>
          </div>
        )}

        {sel.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-primary-soft p-2 text-sm">
            <span className="px-2 font-medium">{sel.size} selected</span>
            <Select onValueChange={(c) => { sel.forEach((id) => updateTxn(id, { category: c })); toast.success(`Moved ${sel.size} to ${c}`); setSel(new Set()); }}>
              <SelectTrigger className="h-8 w-[200px] bg-card"><Tags className="size-4" /><SelectValue placeholder="Set category" /></SelectTrigger>
              <SelectContent>{[...ALL_CATS, ...customCategories].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { deleteTxns([...sel]); toast(`Deleted ${sel.size}`); setSel(new Set()); }}><Trash2 className="size-4" />Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Cancel</Button>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <button className="font-medium hover:text-foreground" onClick={() => setSel(sel.size === list.length ? new Set() : new Set(list.map((t) => t.id)))}>{sel.size === list.length && list.length ? "Deselect all" : "Select all"}</button>
          <span className="num">Net shown: {formatINR(netOf(list))}</span>
        </div>

        {list.length ? (
          <>
            <TxnList txns={list.slice(0, limit)} selectable selected={sel} onToggle={toggle} />
            {list.length > limit && <div className="pt-3 text-center"><Button variant="outline" onClick={() => setLimit((l) => l + 50)}>Show more</Button></div>}
          </>
        ) : <EmptyState icon={Search} title="No matching transactions" text="Try clearing filters or searching for something else." action={<Button variant="outline" size="sm" onClick={clear}>Clear filters</Button>} />}
      </Panel>
    </>
  );
}
