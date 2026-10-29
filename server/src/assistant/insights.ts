import { byCategory, expenseOf, totals } from "../domain/ledger.js";
import { toPaise } from "../money.js";
import type { TxnRec } from "../repo/types.js";
import { inr, pct } from "./money.js";
import { addDays, monthLabel, monthRange, monthsBack, rangeLabel, type Range } from "./periods.js";
import { detectRecurring, runQuery, wsLabel, type FinanceData } from "./queries.js";

/** Verified insights: every one is computed from the owner's records. AI suggestions are a separate, labelled step. */
export interface Insight {
  id: string;
  kind: "increase" | "top_categories" | "profit" | "cash_flow" | "upcoming" | "budget" | "recurring" | "duplicate" | "unusual";
  severity: "info" | "warning" | "alert";
  title: string;
  detail: string;
  period: string;
  figures: { label: string; value: string }[];
  transactionIds?: string[];
}

const inWs = (ws: string) => (t: { workspace: string }) => ws === "all" || t.workspace === ws;
const inR = (r: Range) => (t: { date: string }) => t.date >= r.from && t.date <= r.to;
const P = (r: number) => { try { return toPaise(Math.round(r * 100) / 100); } catch { return 0; } };

/** Month-to-date vs the same days of last month, so a half month isn't compared with a full one. */
export function fairMonthRanges(today: string) {
  const cur: Range = { from: `${today.slice(0, 7)}-01`, to: today, label: "" };
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const prevLast = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const prevEnd = `${prevStart.slice(0, 8)}${String(Math.min(d, prevLast)).padStart(2, "0")}`;
  cur.label = rangeLabel(cur.from, cur.to);
  return { cur, prev: { from: prevStart, to: prevEnd, label: rangeLabel(prevStart, prevEnd) } as Range };
}

export function buildInsights(d: FinanceData, ws: string, today: string): Insight[] {
  const out: Insight[] = [];
  const txns = d.txns.filter(inWs(ws));
  const { cur, prev } = fairMonthRanges(today);
  const curT = txns.filter(inR(cur)), prevT = txns.filter(inR(prev));

  // Category increases (same days, fair comparison)
  const a = new Map(byCategory(curT).map((r) => [r.category, r.amount]));
  const b = new Map(byCategory(prevT).map((r) => [r.category, r.amount]));
  for (const [cat, now] of a) {
    const was = b.get(cat) ?? 0;
    if (was > 0 && now - was >= 100_000 && (now - was) / was >= 0.25) {
      out.push({ id: `inc:${cat}`, kind: "increase", severity: (now - was) / was >= 0.5 ? "warning" : "info", title: `${cat} spending is up ${pct(now, was)}%`,
        detail: `${inr(now)} from ${cur.label}, versus ${inr(was)} for ${prev.label}.`, period: `${cur.label} vs ${prev.label}`,
        figures: [{ label: "This month so far", value: inr(now) }, { label: "Same days last month", value: inr(was) }, { label: "Difference", value: `+${inr(now - was)}` }] });
    }
  }

  // Top categories this month
  const top = byCategory(curT).slice(0, 3);
  if (top.length) out.push({ id: "top", kind: "top_categories", severity: "info", title: `Biggest spending: ${top[0]!.category}`, detail: top.map((r) => `${r.category} ${inr(r.amount)}`).join(" · "), period: cur.label, figures: top.map((r) => ({ label: r.category, value: inr(r.amount) })) });

  // Business profitability
  for (const w of d.workspaces.filter((x) => x.kind === "business" && (ws === "all" || ws === x.key))) {
    const c = totals(d.txns.filter((t) => t.workspace === w.key && inR(cur)(t))), p = totals(d.txns.filter((t) => t.workspace === w.key && inR(prev)(t)));
    if (!c.income && !c.expense && !p.income && !p.expense) continue;
    out.push({ id: `profit:${w.key}`, kind: "profit", severity: c.net < 0 ? "warning" : "info", title: `${w.short} ${c.net >= 0 ? "profit" : "loss"} this month: ${inr(Math.abs(c.net))}`,
      detail: `Income ${inr(c.income)} − expenses ${inr(c.expense)}. Same days last month: ${p.net >= 0 ? "profit" : "loss"} ${inr(Math.abs(p.net))}.`, period: `${cur.label} vs ${prev.label}`,
      figures: [{ label: "Income", value: inr(c.income) }, { label: "Expenses", value: inr(c.expense) }, { label: "Last month (same days)", value: inr(p.net) }] });
  }

  // Cash-flow trend over the last 3 full months
  const months = monthsBack(today, 4).slice(0, 3);
  const flows = months.map((m) => { const r = monthRange(m, today); const t = totals(txns.filter(inR(r))); return { m, net: t.net }; });
  if (flows.some((f) => f.net !== 0)) {
    const falling = flows.length === 3 && flows[0]!.net > flows[1]!.net && flows[1]!.net > flows[2]!.net;
    out.push({ id: "cashflow", kind: "cash_flow", severity: falling || flows[2]!.net < 0 ? "warning" : "info", title: falling ? "Income minus expenses has fallen 3 months in a row" : "Income minus expenses, last 3 months",
      detail: flows.map((f) => `${monthLabel(f.m)}: ${f.net < 0 ? "−" : ""}${inr(Math.abs(f.net))}`).join(" · "), period: `${monthLabel(months[0]!)} – ${monthLabel(months[2]!)}`, figures: flows.map((f) => ({ label: monthLabel(f.m), value: inr(f.net) })) });
  }

  // Upcoming known liabilities
  const up = runQuery({ metric: "upcoming_payments", workspace: ws, period: "this_month", range: cur, compare: false }, d, today);
  if (up.rows?.length) out.push({ id: "upcoming", kind: "upcoming", severity: up.rows.some((r) => r.sub?.includes("overdue")) ? "alert" : "info", title: `${up.rows.length} known payment${up.rows.length > 1 ? "s" : ""} due in 30 days: ${inr(up.figures[0]!.paise!)}`,
    detail: up.rows.slice(0, 4).map((r) => `${r.label} ${inr(r.paise)} (${r.sub})`).join(" · "), period: up.period.label, figures: up.rows.slice(0, 4).map((r) => ({ label: r.label, value: inr(r.paise) })) });

  // Budget warnings
  for (const bd of d.budgets.filter(inWs(ws))) {
    const spent = curT.filter((t) => t.category === bd.category && t.workspace === bd.workspace).reduce((s, t) => s + expenseOf(t), 0);
    const limit = P(bd.limit);
    if (limit > 0 && spent >= limit * 0.8) out.push({ id: `budget:${bd.id}`, kind: "budget", severity: spent > limit ? "alert" : "warning", title: `${bd.category} budget ${spent > limit ? "exceeded" : `at ${Math.round((spent / limit) * 100)}%`}`,
      detail: `${inr(spent)} spent of ${inr(limit)} (${cur.label}).`, period: cur.label, figures: [{ label: "Spent", value: inr(spent) }, { label: "Budget", value: inr(limit) }] });
  }

  // Recurring charges detected from transactions
  const rec = detectRecurring(d.txns, ws, today).slice(0, 5);
  if (rec.length) out.push({ id: "recurring", kind: "recurring", severity: "info", title: `${rec.length} repeating charge${rec.length > 1 ? "s" : ""} found`, detail: rec.map((r) => `${r.merchant} ~${inr(r.monthly)}/month`).join(" · "), period: "Last 4 months", figures: rec.map((r) => ({ label: r.merchant, value: `${inr(r.monthly)}/month` })) });

  // Possible duplicates: no reference, same account/day/amount/merchant (never auto-removed)
  const since = addDays(today, -90);
  const seen = new Map<string, TxnRec>();
  const dupIds: string[][] = [];
  for (const t of txns) {
    if (t.date < since || t.ref) continue;
    const k = `${t.accountId}|${t.date}|${t.amountPaise}|${t.type}|${t.merchant.trim().toLowerCase()}`;
    const x = seen.get(k);
    if (x) dupIds.push([x.id, t.id]); else seen.set(k, t);
  }
  if (dupIds.length) out.push({ id: "dups", kind: "duplicate", severity: "warning", title: `${dupIds.length} possible duplicate${dupIds.length > 1 ? "s" : ""} to check`, detail: "Same account, day, amount and merchant, with no bank reference. They may be genuine repeat payments — review before deleting.", period: rangeLabel(since, today), figures: [], transactionIds: dupIds.flat().slice(0, 20) });

  // Unusually large expenses vs the category's history
  const hist = new Map<string, number[]>();
  for (const t of txns) if (expenseOf(t) > 0 && t.date >= addDays(today, -180)) { const l = hist.get(t.category) ?? []; l.push(expenseOf(t)); hist.set(t.category, l); }
  for (const t of txns.filter((x) => x.date >= addDays(today, -30) && expenseOf(x) >= 200_000)) {
    const l = [...(hist.get(t.category) ?? [])].sort((p, q) => p - q);
    if (l.length < 4) continue;
    const med = l[Math.floor(l.length / 2)]!;
    if (expenseOf(t) >= med * 3) out.push({ id: `unusual:${t.id}`, kind: "unusual", severity: "info", title: `Unusually large ${t.category} payment: ${inr(expenseOf(t))}`, detail: `${t.merchant || t.description} on ${t.date}. Your typical ${t.category} payment is about ${inr(med)}.`, period: "Last 30 days", figures: [{ label: "This payment", value: inr(expenseOf(t)) }, { label: "Typical", value: inr(med) }], transactionIds: [t.id] });
  }

  const order = { alert: 0, warning: 1, info: 2 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]).slice(0, 20).map((i) => ({ ...i, period: i.period || wsLabel(ws, d.workspaces) }));
}
