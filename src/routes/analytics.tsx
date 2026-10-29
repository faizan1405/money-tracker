import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFinance, useScoped } from "@/lib/finance/store";
import { byCategory, expenseOf, monthly, toCSV, totals } from "@/lib/finance/calc";
import { downloadCSV } from "@/lib/finance/download";
import { formatCompact, formatINR } from "@/lib/finance/format";
import { PROJECTS } from "@/lib/finance/data";
import { PageHeader, Panel, Progress, tooltipStyle } from "@/components/app/ui-bits";
import { PeriodSelect, usePeriodTxns } from "@/components/app/PeriodSelect";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Money Hub AI" },
      { name: "description", content: "Cash flow, profitability, category trends and project profits." },
      { property: "og:title", content: "Analytics — Money Hub AI" },
      { property: "og:description", content: "Cash flow, profitability, category trends and project profits." },
    ],
  }),
  component: Analytics,
});

function Analytics() {
  const f = useFinance();
  const { txns, dues } = useScoped();
  const { current } = usePeriodTxns();
  const trend = useMemo(() => monthly(txns, 6), [txns]);
  const t = totals(current);
  const biz = totals(current.filter((x) => x.workspace === "scaleflow"));
  const ownerDraws = current.filter((x) => x.type === "transfer" && x.workspace === "scaleflow").reduce((s, x) => s + x.amount, 0);
  const cats = byCategory(current).slice(0, 8);
  const maxCat = cats[0]?.value ?? 1;

  return (
    <>
      <PageHeader title="Analytics" actions={<>
        <PeriodSelect />
        <Button variant="outline" onClick={() => downloadCSV("money-hub-report.csv", toCSV(current, f.accounts))}><Download className="size-4" />CSV</Button>
        <Button variant="outline" onClick={() => toast("PDF reports will be available once the backend is connected.")}><FileDown className="size-4" />PDF</Button>
      </>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Net cash flow" value={t.net} note="Money in − money out" />
        <Metric label="Scale Flow cash profit" value={biz.bizProfit} note="Business income − business expenses" />
        <Metric label="Business cash flow" value={biz.bizProfit - ownerDraws} note={`After owner draws of ${formatINR(ownerDraws)}`} />
        <Metric label="Savings rate" value={t.income ? Math.round((t.net / t.income) * 100) : 0} pct note="Share of income kept" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Monthly income & expenses">
          <div className="h-64"><ResponsiveContainer><BarChart data={trend} margin={{ left: -10 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "var(--secondary)" }} {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Income" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expense" name="Expenses" fill="var(--chart-4)" radius={[6, 6, 0, 0]} />
          </BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Business profit vs net cash flow">
          <div className="h-64"><ResponsiveContainer><LineChart data={trend} margin={{ left: -10 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
            <Tooltip formatter={(v: number) => formatINR(v)} {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="profit" name="Business profit" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} />
            <Line dataKey="net" name="Net cash flow" stroke="var(--chart-3)" strokeWidth={2.5} dot={false} />
          </LineChart></ResponsiveContainer></div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Category breakdown">
          <ul className="space-y-3">
            {cats.map((c) => (
              <li key={c.name}><div className="mb-1 flex justify-between text-sm"><span>{c.name}</span><span className="num font-semibold">{formatINR(c.value)}</span></div><Progress value={(c.value / maxCat) * 100} tone="positive" /></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Receivables & payables">
          <ul className="divide-y text-sm">
            {dues.map((d) => (
              <li key={d.id} className="flex justify-between py-2.5"><span>{d.party}</span><span className={`num font-semibold ${d.direction === "i_owe" ? "text-negative" : "text-positive"}`}>{d.direction === "i_owe" ? "−" : "+"}{formatINR(d.outstanding)}</span></li>
            ))}
          </ul>
        </Panel>
      </div>

      {f.mode === "production" ? (
        <Panel title="Project profitability" className="mt-4"><p className="text-sm text-muted-foreground">Clients, projects and invoices aren't available on your server yet. This section will show real project profit once that module is added.</p></Panel>
      ) : (
      <Panel title="Project profitability · Scale Flow (all time)" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Client</th><th className="pb-2 font-medium">Project</th><th className="pb-2 text-right font-medium">Value</th><th className="pb-2 text-right font-medium">Received</th><th className="pb-2 text-right font-medium">Project costs</th><th className="pb-2 text-right font-medium">Est. profit</th></tr></thead>
            <tbody className="divide-y">
              {PROJECTS.map((p) => {
                const rec = f.txns.filter((x) => x.project === p.name && x.type === "income").reduce((s, x) => s + x.amount, 0);
                const cost = f.txns.filter((x) => x.project === p.name).reduce((s, x) => s + expenseOf(x), 0);
                return (
                  <tr key={p.id}>
                    <td className="py-2.5">{p.client}</td><td>{p.name}</td>
                    <td className="num text-right">{formatINR(p.value)}</td><td className="num text-right text-positive">{formatINR(rec)}</td>
                    <td className="num text-right">{formatINR(cost)}</td><td className="num text-right font-semibold">{formatINR(rec - cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Estimated profit = payments received − costs tagged to the project. Personal spending, loan principal and transfers are never counted as business expenses.</p>
      </Panel>
      )}
    </>
  );
}

function Metric({ label, value, note, pct }: { label: string; value: number; note: string; pct?: boolean }) {
  return (
    <div className="surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`num mt-2 text-2xl font-semibold ${value < 0 ? "text-negative" : ""}`}>{pct ? `${value}%` : formatINR(value)}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}
