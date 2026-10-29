import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Briefcase, CalendarClock, HandCoins, Lightbulb, Scale, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth/session";
import { useFinance, useScoped } from "@/lib/finance/store";
import { accountBalance, byCategory, monthly, totals } from "@/lib/finance/calc";
import { formatCompact, formatDate, formatINR } from "@/lib/finance/format";
import { CHART_COLORS, EmptyState, PageHeader, Panel, Pill, Progress, StatCard, tooltipStyle } from "@/components/app/ui-bits";
import { PeriodSelect, PERIOD_LABEL, usePeriodTxns } from "@/components/app/PeriodSelect";
import { TxnList } from "@/components/app/TxnList";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Money Hub AI" },
      { name: "description", content: "See where your money is, what you earned, spent, owe and are owed at a glance." },
      { property: "og:title", content: "Dashboard — Money Hub AI" },
      { property: "og:description", content: "Your personal and business finances at a glance." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const f = useFinance();
  const { user } = useAuth();
  const { txns, accounts, dues } = useScoped();
  const { current, previous } = usePeriodTxns();
  const t = totals(current);
  const p = totals(previous);
  const bal = accounts.filter((a) => a.kind !== "credit_card").reduce((s, a) => s + accountBalance(a, f.txns), 0);
  const receivable = dues.filter((d) => d.direction === "owed_to_me").reduce((s, d) => s + d.outstanding, 0);
  const payable = dues.filter((d) => d.direction === "i_owe").reduce((s, d) => s + d.outstanding, 0);
  const trend = useMemo(() => monthly(txns, 6), [txns]);
  const cats = byCategory(current);
  const now = Date.now();

  const monthCats = byCategory(current);
  const alerts = useMemo(() => {
    const out: string[] = [];
    const prevCats = byCategory(previous);
    monthCats.forEach((c) => {
      const pv = prevCats.find((x) => x.name === c.name)?.value ?? 0;
      if (pv > 0 && c.value > pv * 1.3 && c.value > 1500) out.push(`${c.name} is ${Math.round(((c.value - pv) / pv) * 100)}% higher than the previous period (${formatINR(c.value)}).`);
    });
    current.filter((x) => x.type === "expense" && x.amount > 10000).forEach((x) => out.push(`Large expense: ${x.merchant} — ${formatINR(x.amount)}.`));
    return out.slice(0, 4);
  }, [current, previous, monthCats]);

  if (!f.ready) return <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;

  const upcoming = [
    ...dues.filter((d) => d.direction === "i_owe").map((d) => ({ id: d.id, name: d.party, amount: d.emi ?? d.outstanding, date: d.dueDate })),
    ...f.recurring.filter((r) => f.workspace === "all" || r.workspace === f.workspace).map((r) => ({ id: r.id, name: r.name, amount: r.amount, date: r.nextDate })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  return (
    <>
      <PageHeader title={`Good to see you, ${user?.name?.split(" ")[0] ?? "Faizan"}`} subtitle={`${PERIOD_LABEL[f.period]} · ${f.workspace === "all" ? "All finances" : f.workspace === "personal" ? "Personal" : "Business: Scale Flow"}`} actions={<PeriodSelect />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Money In" value={t.income} prev={p.income} icon={ArrowDownToLine} tone="positive" />
        <StatCard label="Money Out" value={t.expense} prev={p.expense} icon={ArrowUpFromLine} tone="negative" invert />
        <StatCard label="Available Balance" value={bal} icon={Wallet} hint="Bank, UPI, cash & wallets" />
        <StatCard label="Business Profit" value={t.bizProfit} prev={p.bizProfit} icon={Briefcase} tone="positive" />
        <StatCard label="Receivables" value={receivable} icon={HandCoins} tone="warning" hint="Owed to you" />
        <StatCard label="Payables" value={payable} icon={Scale} tone="negative" hint="Loans & dues you owe" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Income vs expenses · 6 months" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ left: -10, right: 4 }}>
                <defs>
                  <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.3} /><stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-4)" stopOpacity={0.2} /><stop offset="1" stopColor="var(--chart-4)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip formatter={(v: number) => formatINR(v)} {...tooltipStyle} />
                <Area type="monotone" dataKey="income" name="Money in" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gi)" />
                <Area type="monotone" dataKey="expense" name="Money out" stroke="var(--chart-4)" strokeWidth={2} fill="url(#ge)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Spending by category">
          {cats.length ? (
            <>
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={cats.slice(0, 6)} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none">
                      {cats.slice(0, 6).map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatINR(v)} {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {cats.slice(0, 5).map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2 text-xs">
                    <span className="size-2 rounded-full" style={{ background: CHART_COLORS[i] }} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="num font-semibold">{formatINR(c.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <EmptyState title="No spending in this period" />}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Personal vs business spending">
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "var(--secondary)" }} {...tooltipStyle} />
                <Bar dataKey="personal" name="Personal" stackId="a" fill="var(--chart-3)" />
                <Bar dataKey="business" name="Business" stackId="a" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Monthly net cash flow">
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "var(--secondary)" }} {...tooltipStyle} />
                <Bar dataKey="net" name="Net" radius={[6, 6, 6, 6]}>{trend.map((r) => <Cell key={r.key} fill={r.net >= 0 ? "var(--positive)" : "var(--negative)"} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Scale Flow profit trend">
          <div className="h-52">
            <ResponsiveContainer>
              <AreaChart data={monthly(f.txns.filter((x) => x.workspace === "scaleflow"), 6)} margin={{ left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip formatter={(v: number) => formatINR(v)} {...tooltipStyle} />
                <Area type="monotone" dataKey="profit" name="Profit" stroke="var(--chart-2)" strokeWidth={2} fill="var(--warning-soft)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Recent transactions" className="lg:col-span-2" action={<Link to="/transactions" className="text-xs font-semibold text-primary">View all</Link>}>
          {txns.length ? <TxnList txns={txns.slice(0, 7)} compact /> : <EmptyState title="No transactions yet" />}
        </Panel>
        <div className="space-y-4">
          <Panel title="Upcoming EMIs & bills" action={<CalendarClock className="size-4 text-muted-foreground" />}>
            <ul className="space-y-3">
              {upcoming.map((u) => {
                const overdue = new Date(u.date).getTime() < now;
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0"><div className="truncate font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{formatDate(u.date, { day: "numeric", month: "short" })}</div></div>
                    <div className="text-right"><div className="num font-semibold">{formatINR(u.amount)}</div>{overdue && <Pill tone="negative">Overdue</Pill>}</div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="Client payments pending">
            <ul className="space-y-3">
              {f.dues.filter((d) => d.kind === "client").map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.party}</span>
                  <span className="num font-semibold text-warning">{formatINR(d.outstanding)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Budget progress · this month" action={<Link to="/budgets" className="text-xs font-semibold text-primary">Manage</Link>}>
          <BudgetMini />
        </Panel>
        <Panel title="Unusual spending alerts">
          {alerts.length ? (
            <ul className="space-y-2.5">{alerts.map((a) => <li key={a} className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />{a}</li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Nothing unusual in this period.</p>}
        </Panel>
        <Panel title="Insights" action={<Pill tone="info">Rule-based preview</Pill>}>
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />You kept {t.income ? Math.max(0, Math.round((t.net / t.income) * 100)) : 0}% of what came in this period.</li>
            {cats[0] && <li className="flex gap-2"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />{cats[0].name} is your top spend at {formatINR(cats[0].value)}.</li>}
            <li className="flex gap-2"><Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />Clients owe Scale Flow {formatINR(f.dues.filter((d) => d.kind === "client").reduce((s, d) => s + d.outstanding, 0))}.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function BudgetMini() {
  const f = useFinance();
  const { current } = usePeriodTxns();
  const budgets = f.budgets.filter((b) => f.workspace === "all" || b.workspace === f.workspace);
  const spentBy = byCategory(f.period === "month" ? current : f.txns.filter((t) => new Date(t.date).getMonth() === new Date().getMonth() && new Date(t.date).getFullYear() === new Date().getFullYear()));
  return (
    <ul className="space-y-3.5">
      {budgets.map((b) => {
        const spent = spentBy.find((c) => c.name === b.category)?.value ?? 0;
        const pct = (spent / b.limit) * 100;
        return (
          <li key={b.id}>
            <div className="mb-1.5 flex justify-between text-xs"><span className="font-medium">{b.category}</span><span className="num text-muted-foreground">{formatINR(spent)} / {formatINR(b.limit)}</span></div>
            <Progress value={pct} />
          </li>
        );
      })}
    </ul>
  );
}
