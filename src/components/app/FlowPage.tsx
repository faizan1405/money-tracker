import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinance, useScoped } from "@/lib/finance/store";
import { byCategory, expenseOf, incomeOf, monthly } from "@/lib/finance/calc";
import { formatCompact, formatINR } from "@/lib/finance/format";
import { BUSINESS_CATEGORIES, PERSONAL_CATEGORIES, PROJECTS } from "@/lib/finance/data";
import { CHART_COLORS, CategoryIcon, EmptyState, PageHeader, Panel, Pill, Progress, tooltipStyle } from "./ui-bits";
import { PeriodSelect, usePeriodTxns } from "./PeriodSelect";
import { TxnList } from "./TxnList";

export function FlowPage({ mode }: { mode: "in" | "out" }) {
  const f = useFinance();
  const { txns } = useScoped();
  const { current, previous } = usePeriodTxns();
  const val = mode === "in" ? incomeOf : expenseOf;
  const list = current.filter((t) => (mode === "in" ? t.type === "income" : val(t) !== 0));
  const total = list.reduce((s, t) => s + val(t), 0);
  const prevTotal = previous.reduce((s, t) => s + val(t), 0);
  const trend = useMemo(() => monthly(txns, 6), [txns]);
  const sources = useMemo(() => {
    if (mode === "out") return byCategory(current);
    const m = new Map<string, number>();
    list.forEach((t) => m.set(t.category, (m.get(t.category) ?? 0) + t.amount));
    return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [current, list, mode]);
  const prevCats = byCategory(previous);
  const [newCat, setNewCat] = useState("");

  return (
    <>
      <PageHeader title={mode === "in" ? "Money In" : "Money Out"} subtitle={mode === "in" ? "Salary, client payments, interest and other income. Transfers and loans are excluded." : "Everything you spent. Card bill payments, transfers and loan principal are not counted twice."}
        actions={<><PeriodSelect /><Button onClick={() => f.openAdd({ type: mode === "in" ? "income" : "expense", category: mode === "in" ? "Client Payment" : "Food & Dining" })}><Plus className="size-4" />{mode === "in" ? "Add income" : "Add expense"}</Button></>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Last 6 months">
          <div className="mb-2 flex items-baseline gap-3">
            <span className={`num font-display text-4xl ${mode === "in" ? "text-positive" : "text-foreground"}`}>{formatINR(total)}</span>
            <span className="text-sm text-muted-foreground">this period · previous {formatINR(prevTotal)}</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "var(--secondary)" }} {...tooltipStyle} />
                <Bar dataKey={mode === "in" ? "income" : "expense"} name={mode === "in" ? "Money in" : "Money out"} fill={mode === "in" ? "var(--chart-1)" : "var(--chart-4)"} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title={mode === "in" ? "Income sources" : "Top categories"}>
          {sources.length ? (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <PieChart><Pie data={sources.slice(0, 6)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} stroke="none">{sources.slice(0, 6).map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}</Pie><Tooltip formatter={(v: number) => formatINR(v)} {...tooltipStyle} /></PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2.5">
                {sources.slice(0, 7).map((c) => {
                  const pv = prevCats.find((x) => x.name === c.name)?.value ?? 0;
                  return (
                    <li key={c.name} className="flex items-center gap-2.5 text-sm">
                      <CategoryIcon category={c.name} className="size-8" />
                      <span className="flex-1 truncate">{c.name}</span>
                      <div className="text-right"><div className="num font-semibold">{formatINR(c.value)}</div>{mode === "out" && pv > 0 && <div className={`text-[11px] ${c.value > pv ? "text-negative" : "text-positive"}`}>{c.value > pv ? "▲" : "▼"} vs {formatINR(pv)}</div>}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : <EmptyState title="Nothing in this period" />}
        </Panel>
      </div>

      {mode === "in" && f.workspace !== "personal" && (
        <Panel title="Client projects · invoiced vs received" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROJECTS.map((p) => {
              const received = f.txns.filter((t) => t.type === "income" && t.project === p.name).reduce((s, t) => s + t.amount, 0);
              return (
                <div key={p.id} className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">{p.client}</div>
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Invoiced</span><span className="num">{formatINR(p.invoiced)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span className="num font-semibold text-positive">{formatINR(received)}</span></div>
                  </div>
                  <div className="mt-2"><Progress value={(received / p.invoiced) * 100} tone="positive" /></div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {mode === "out" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Recurring expenses" action={<Repeat className="size-4 text-muted-foreground" />}>
            <ul className="divide-y">
              {f.recurring.filter((r) => f.workspace === "all" || r.workspace === f.workspace).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <CategoryIcon category={r.category} className="size-8" />
                  <span className="flex-1">{r.name}</span>
                  <Pill>{r.cadence}</Pill>
                  <span className="num font-semibold">{formatINR(r.amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Categories">
            <div className="space-y-3 text-sm">
              <div><div className="mb-1.5 text-xs font-semibold text-muted-foreground">Personal</div><div className="flex flex-wrap gap-1.5">{PERSONAL_CATEGORIES.map((c) => <Pill key={c}>{c}</Pill>)}</div></div>
              <div><div className="mb-1.5 text-xs font-semibold text-muted-foreground">Business</div><div className="flex flex-wrap gap-1.5">{BUSINESS_CATEGORIES.map((c) => <Pill key={c}>{c}</Pill>)}</div></div>
              {f.customCategories.length > 0 && <div><div className="mb-1.5 text-xs font-semibold text-muted-foreground">Custom</div><div className="flex flex-wrap gap-1.5">{f.customCategories.map((c) => <Pill key={c} tone="primary">{c}</Pill>)}</div></div>}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = newCat.trim(); if (!c) return; void f.update("customCategories", [...new Set([...f.customCategories, c])]).then((ok) => { if (ok) { setNewCat(""); toast.success(`Added category ${c}`); } }); }}>
                <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New custom category" /><Button type="submit" variant="secondary">Add</Button>
              </form>
            </div>
          </Panel>
        </div>
      )}

      <Panel title={`${list.length} transactions`} className="mt-4">
        {list.length ? <TxnList txns={list.slice(0, 40)} /> : <EmptyState title="Nothing recorded in this period" />}
      </Panel>
    </>
  );
}
