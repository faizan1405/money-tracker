import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, PiggyBank, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinance } from "@/lib/finance/store";
import { byCategory, inRange, periodRange } from "@/lib/finance/calc";
import { formatDate, formatINR } from "@/lib/finance/format";
import { BUSINESS_CATEGORIES, PERSONAL_CATEGORIES } from "@/lib/finance/data";
import { CategoryIcon, PageHeader, Panel, Pill, Progress } from "@/components/app/ui-bits";

export const Route = createFileRoute("/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets & Goals — Money Hub AI" },
      { name: "description", content: "Monthly budgets, savings goals and upcoming renewals." },
      { property: "og:title", content: "Budgets & Goals — Money Hub AI" },
      { property: "og:description", content: "Monthly budgets, savings goals and upcoming renewals." },
    ],
  }),
  component: Budgets,
});

function Budgets() {
  const f = useFinance();
  const month = f.txns.filter((t) => inRange(t, periodRange("month")));
  const spent = byCategory(month);
  const budgets = f.budgets.filter((b) => f.workspace === "all" || b.workspace === f.workspace);
  const [cat, setCat] = useState("");
  const [limit, setLimit] = useState("");
  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + (spent.find((c) => c.name === b.category)?.value ?? 0), 0);
  const over = budgets.filter((b) => (spent.find((c) => c.name === b.category)?.value ?? 0) > b.limit);

  return (
    <>
      <PageHeader title="Budgets & goals" subtitle="This month's progress, savings goals and what's renewing soon." />
      {over.length > 0 && (
        <div className="mb-4 flex gap-2 rounded-xl bg-negative-soft p-3 text-sm text-negative"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Over budget: {over.map((b) => b.category).join(", ")}</div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Monthly budgets" className="lg:col-span-2">
          <div className="mb-5 rounded-xl bg-secondary p-4">
            <div className="flex justify-between text-sm"><span>Total budgeted</span><span className="num font-semibold">{formatINR(totalSpent)} / {formatINR(totalLimit)}</span></div>
            <div className="mt-2"><Progress value={(totalSpent / (totalLimit || 1)) * 100} /></div>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {budgets.map((b) => {
              const s = spent.find((c) => c.name === b.category)?.value ?? 0;
              const pct = (s / b.limit) * 100;
              return (
                <li key={b.id} className="rounded-xl border p-3">
                  <div className="flex items-center gap-2.5">
                    <CategoryIcon category={b.category} className="size-8" />
                    <div className="flex-1"><div className="text-sm font-medium">{b.category}</div><div className="text-xs text-muted-foreground">{formatINR(Math.max(0, b.limit - s))} left</div></div>
                    {pct >= 100 ? <Pill tone="negative">Over</Pill> : pct >= 80 ? <Pill tone="warning">{Math.round(pct)}%</Pill> : <Pill>{Math.round(pct)}%</Pill>}
                  </div>
                  <div className="mt-3"><Progress value={pct} /></div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="num text-xs text-muted-foreground">{formatINR(s)} of</span>
                    <Input className="num h-7 w-24 text-xs" inputMode="numeric" defaultValue={b.limit} onBlur={(e) => { const v = Number(e.target.value); if (v > 0) f.update("budgets", f.budgets.map((x) => (x.id === b.id ? { ...x, limit: v } : x))); }} aria-label={`${b.category} limit`} />
                    <button className="ml-auto text-xs text-muted-foreground hover:text-destructive" onClick={() => f.update("budgets", f.budgets.filter((x) => x.id !== b.id))}>Remove</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!cat || !Number(limit)) { toast.error("Choose a category and limit"); return; }
            f.update("budgets", [...f.budgets, { id: `b${Date.now()}`, category: cat, limit: Number(limit), workspace: BUSINESS_CATEGORIES.includes(cat) ? "scaleflow" : "personal" }]);
            setCat(""); setLimit(""); toast.success("Budget added");
          }}>
            <Select value={cat} onValueChange={setCat}><SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent>{[...PERSONAL_CATEGORIES, ...BUSINESS_CATEGORIES, ...f.customCategories].filter((c) => !f.budgets.some((b) => b.category === c)).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            <Input className="w-32" inputMode="numeric" placeholder="Limit ₹" value={limit} onChange={(e) => setLimit(e.target.value)} />
            <Button type="submit" variant="secondary"><Plus className="size-4" />Add budget</Button>
          </form>
        </Panel>

        <div className="space-y-4">
          <Panel title="Savings goals" action={<PiggyBank className="size-4 text-muted-foreground" />}>
            <ul className="space-y-4">
              {f.goals.map((g) => (
                <li key={g.id}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{g.name}</span><span className="num text-xs text-muted-foreground">by {formatDate(g.deadline, { month: "short", year: "numeric" })}</span></div>
                  <div className="my-1.5"><Progress value={(g.saved / g.target) * 100} tone="positive" /></div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="num">{formatINR(g.saved)} / {formatINR(g.target)}</span>
                    <button className="font-semibold text-primary" onClick={() => { f.update("goals", f.goals.map((x) => (x.id === g.id ? { ...x, saved: Math.min(x.target, x.saved + 1000) } : x))); }}>+ ₹1,000</button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Upcoming renewals & bills" action={<CalendarClock className="size-4 text-muted-foreground" />}>
            <ul className="space-y-3">
              {f.recurring.slice().sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map((r) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{formatDate(r.nextDate, { day: "numeric", month: "short" })} · {r.cadence}</div></div>
                  <span className="num font-semibold">{formatINR(r.amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
