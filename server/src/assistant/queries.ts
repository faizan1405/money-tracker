import { accountBalance, byCategory, expenseOf, incomeOf, totals } from "../domain/ledger.js";
import type { AccountRec, BudgetDTO, DueDTO, RecurringDTO, Repo, TxnRec, WorkspaceRec } from "../repo/types.js";
import { toPaise } from "../money.js";
import { inr, pct } from "./money.js";
import { addDays, daysBetween, fmtDate, monthLabel, monthRange, monthsBack, previousPeriod, rangeLabel, type PeriodKey, type Range } from "./periods.js";

/**
 * The ONLY ways the assistant can read finance data: fixed, owner-scoped, read-only functions.
 * The AI chooses a metric from this allowlist; it never writes SQL, never sees raw ledgers, and every number in an
 * answer is computed here with the same rules as the rest of the app (domain/ledger.ts).
 */
export const METRICS = [
  "spending", "income", "profit", "cash_flow", "balances", "category_breakdown", "category_spend", "merchant_spend",
  "owed_to_me", "i_owe", "upcoming_payments", "increasing_expenses", "recurring_expenses", "unnecessary_expenses", "summary", "unsupported",
] as const;
export type Metric = (typeof METRICS)[number];

export interface FinanceData { txns: TxnRec[]; accounts: AccountRec[]; dues: DueDTO[]; recurring: RecurringDTO[]; budgets: BudgetDTO[]; workspaces: WorkspaceRec[] }

/** One owner-scoped read of everything the read-only queries need. */
export async function loadFinance(repo: Repo, ownerId: string): Promise<FinanceData> {
  const [{ items }, accounts, dues, recurring, budgets, workspaces] = await Promise.all([
    repo.listTxns(ownerId), repo.listAccounts(ownerId), repo.getCollection(ownerId, "dues"), repo.getCollection(ownerId, "recurring"),
    repo.getCollection(ownerId, "budgets"), repo.listWorkspaces(ownerId),
  ]);
  return { txns: items, accounts, dues, recurring, budgets, workspaces };
}

export interface Query { metric: Metric; workspace: string; period: PeriodKey; range: Range; compare: boolean; term?: string | null }

export interface Figure { key: string; label: string; paise?: number; text?: string; tone?: "positive" | "negative" }
export interface FactRow { label: string; paise: number; sub?: string }
export interface Facts {
  metric: Metric;
  workspace: string;
  workspaceLabel: string;
  period: Range;
  comparePeriod?: Range;
  figures: Figure[];
  rowsTitle?: string;
  rows?: FactRow[];
  transactions?: { id: string; date: string; merchant: string; category: string; paise: number }[];
  chart?: { title: string; series: [string] | [string, string]; points: { label: string; a: number; b?: number }[] };
  notes: string[];
  /** Ideas built from facts (e.g. discretionary categories). Shown separately, never presented as facts. */
  suggestionsBasis?: string[];
  empty: boolean;
}

const P = (rupees: number) => { try { return toPaise(Math.round(rupees * 100) / 100); } catch { return 0; } };
const DISCRETIONARY = ["Food & Dining", "Shopping", "Entertainment", "Subscriptions"];

export function wsLabel(ws: string, list: WorkspaceRec[]) {
  if (ws === "all") return "All workspaces";
  return list.find((w) => w.key === ws)?.short ?? ws;
}
const inWs = (ws: string) => (t: { workspace: string }) => ws === "all" || t.workspace === ws;
const inRange = (r: Range) => (t: { date: string }) => t.date >= r.from && t.date <= r.to;
const matches = (term: string) => { const q = term.trim().toLowerCase(); return (t: TxnRec) => t.category.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q) || t.description.toLowerCase().includes(q); };
const txnLink = (t: TxnRec) => ({ id: t.id, date: t.date, merchant: t.merchant || t.description.slice(0, 60), category: t.category, paise: expenseOf(t) || incomeOf(t) || t.amountPaise });

/** Money in/out of the owner's accounts, ignoring moves between their own accounts (transfers, card bill payments). */
function cashFlow(txns: TxnRec[]) {
  let inflow = 0, outflow = 0;
  for (const t of txns) {
    if (t.type === "transfer" || t.type === "cc_payment") continue;
    if (t.type === "income" || t.type === "refund" || t.type === "loan_disbursement") inflow += t.amountPaise;
    else if (t.type === "adjustment") { if ((t.adjustmentSign ?? 1) > 0) inflow += t.amountPaise; else outflow += t.amountPaise; }
    else outflow += t.amountPaise; // expense + full loan repayment leave the account
  }
  return { inflow, outflow, net: inflow - outflow };
}

function categoryDeltas(cur: TxnRec[], prev: TxnRec[]) {
  const a = new Map(byCategory(cur).map((r) => [r.category, r.amount]));
  const b = new Map(byCategory(prev).map((r) => [r.category, r.amount]));
  return [...new Set([...a.keys(), ...b.keys()])].map((c) => ({ category: c, cur: a.get(c) ?? 0, prev: b.get(c) ?? 0 }));
}

/** Merchants charged in at least 3 of the last 4 months with similar amounts → likely subscriptions/recurring. */
export function detectRecurring(txns: TxnRec[], ws: string, today: string) {
  const months = monthsBack(today, 4);
  const by = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!inWs(ws)(t) || t.type === "loan_repayment" || expenseOf(t) <= 0 || !months.includes(t.date.slice(0, 7))) continue;
    const k = (t.merchant || t.description).trim().toLowerCase();
    if (!k) continue;
    const m = by.get(k) ?? new Map<string, number>();
    m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + expenseOf(t));
    by.set(k, m);
  }
  const out: { merchant: string; monthly: number; months: number }[] = [];
  for (const [k, m] of by) {
    if (m.size < 3) continue;
    const vals = [...m.values()];
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (vals.every((v) => Math.abs(v - avg) <= avg * 0.25)) {
      const name = txns.find((t) => (t.merchant || t.description).trim().toLowerCase() === k)!;
      out.push({ merchant: name.merchant || name.description, monthly: Math.round(avg), months: m.size });
    }
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export function runQuery(q: Query, d: FinanceData, today: string): Facts {
  const label = wsLabel(q.workspace, d.workspaces);
  const scoped = d.txns.filter(inWs(q.workspace));
  const cur = scoped.filter(inRange(q.range));
  const prevRange = q.compare ? previousPeriod(q.period, q.range) : undefined;
  const prev = prevRange ? scoped.filter(inRange(prevRange)) : [];
  const f: Facts = { metric: q.metric, workspace: q.workspace, workspaceLabel: label, period: q.range, figures: [], notes: [], empty: false, ...(prevRange ? { comparePeriod: prevRange } : {}) };
  if (q.range.partial) f.notes.push(`${q.range.label} is still in progress, so totals cover only the days so far.`);
  const cmp = (key: string, labelText: string, a: number, b: number) => {
    f.figures.push({ key: `${key}_prev`, label: `${labelText} (${prevRange!.label})`, paise: b });
    const p = pct(a, b);
    f.figures.push({ key: `${key}_change`, label: "Change", paise: Math.abs(a - b), text: `${a >= b ? "+" : "−"}${inr(Math.abs(a - b))}${p === null ? "" : ` (${p > 0 ? "+" : ""}${p}%)`}`, tone: a > b ? "negative" : "positive" });
  };
  const monthlyChart = (title: string, pick: (ts: TxnRec[]) => [number, number?], series: [string] | [string, string]) => {
    const ms = monthsBack(today, 6);
    f.chart = { title, series, points: ms.map((m) => { const r = monthRange(m, today); const [a, b] = pick(scoped.filter(inRange(r))); return { label: monthLabel(m).slice(0, 3), a, ...(b === undefined ? {} : { b }) }; }) };
  };

  switch (q.metric) {
    case "spending":
    case "category_breakdown": {
      const t = totals(cur);
      f.figures.push({ key: "expense", label: `Spent (${q.range.label})`, paise: t.expense, tone: "negative" });
      if (prevRange) cmp("expense", "Spent", t.expense, totals(prev).expense);
      const cats = byCategory(cur);
      f.rowsTitle = "By category";
      f.rows = cats.slice(0, q.metric === "category_breakdown" ? 12 : 6).map((r) => ({ label: r.category, paise: r.amount, sub: t.expense ? `${Math.round((r.amount / t.expense) * 100)}%` : "" }));
      f.transactions = cur.filter((x) => expenseOf(x) > 0).sort((a, b) => expenseOf(b) - expenseOf(a)).slice(0, 5).map(txnLink);
      monthlyChart("Spending by month", (ts) => [totals(ts).expense], ["Spent"]);
      f.empty = cur.length === 0;
      f.notes.push("Spending counts expenses and loan interest, minus refunds. Transfers between your accounts, card bill payments and loan principal are not spending.");
      break;
    }
    case "income": {
      const t = totals(cur);
      f.figures.push({ key: "income", label: `Income (${q.range.label})`, paise: t.income, tone: "positive" });
      if (prevRange) cmp("income", "Income", t.income, totals(prev).income);
      const m = new Map<string, number>();
      for (const x of cur) if (incomeOf(x)) m.set(x.merchant || x.category, (m.get(x.merchant || x.category) ?? 0) + incomeOf(x));
      f.rowsTitle = "Top sources";
      f.rows = [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, paise]) => ({ label, paise }));
      f.transactions = cur.filter((x) => incomeOf(x) > 0).sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5).map(txnLink);
      monthlyChart("Income by month", (ts) => [totals(ts).income], ["Income"]);
      f.empty = cur.length === 0;
      f.notes.push("Income excludes refunds, loans received and transfers between your accounts.");
      break;
    }
    case "profit": {
      const t = totals(cur);
      const isBiz = q.workspace !== "all" && d.workspaces.find((w) => w.key === q.workspace)?.kind === "business";
      const word = isBiz ? "Profit" : q.workspace === "all" ? "Net (income − expenses)" : "Savings (income − expenses)";
      f.figures.push({ key: "income", label: "Income", paise: t.income, tone: "positive" }, { key: "expense", label: "Expenses", paise: t.expense, tone: "negative" }, { key: "net", label: word, paise: t.net, tone: t.net >= 0 ? "positive" : "negative" });
      if (q.workspace === "all") f.figures.push({ key: "biz_profit", label: "Business profit (all businesses)", paise: t.bizProfit, tone: t.bizProfit >= 0 ? "positive" : "negative" });
      if (prevRange) cmp("net", word, t.net, totals(prev).net);
      monthlyChart(isBiz ? "Profit by month" : "Income vs expenses", (ts) => { const x = totals(ts); return [x.income, x.expense]; }, ["Income", "Expenses"]);
      f.empty = cur.length === 0;
      f.notes.push("Profit = income − expenses for the period. It is not the same as cash in the bank: transfers, loans and card bill payments are excluded.");
      break;
    }
    case "cash_flow": {
      const c = cashFlow(cur);
      f.figures.push({ key: "inflow", label: "Money in", paise: c.inflow, tone: "positive" }, { key: "outflow", label: "Money out", paise: c.outflow, tone: "negative" }, { key: "net", label: "Net cash flow", paise: c.net, tone: c.net >= 0 ? "positive" : "negative" });
      if (prevRange) cmp("net", "Net cash flow", c.net, cashFlow(prev).net);
      monthlyChart("Cash in vs out", (ts) => { const x = cashFlow(ts); return [x.inflow, x.outflow]; }, ["In", "Out"]);
      f.empty = cur.length === 0;
      f.notes.push("Cash flow includes loans received and full EMI payments, and ignores moves between your own accounts. It can differ from profit.");
      break;
    }
    case "balances": {
      const accs = d.accounts.filter(inWs(q.workspace));
      const rows = accs.map((a) => ({ a, bal: accountBalance(a.openingBalancePaise, a.id, d.txns) }));
      const cash = rows.filter((r) => r.a.kind !== "credit_card").reduce((s, r) => s + r.bal, 0);
      const card = rows.filter((r) => r.a.kind === "credit_card").reduce((s, r) => s + r.bal, 0);
      f.period = { from: today, to: today, label: `as of ${fmtDate(today)}` };
      f.figures.push({ key: "available", label: "Available in bank, cash & wallets", paise: cash, tone: cash >= 0 ? "positive" : "negative" });
      if (rows.some((r) => r.a.kind === "credit_card")) f.figures.push({ key: "card_due", label: "Credit card balance owed", paise: Math.max(0, -card), tone: "negative" });
      f.rowsTitle = "Accounts";
      f.rows = rows.map((r) => ({ label: r.a.name, paise: r.bal, sub: r.a.kind === "credit_card" ? "credit card" : r.a.reconciled === "reconciled" ? "reconciled" : "not reconciled" }));
      f.empty = accs.length === 0;
      f.notes.push("Balances are calculated from each account's opening balance plus every recorded transaction. Unrecorded bank activity is not included.");
      if (rows.some((r) => r.a.reconciled !== "reconciled")) f.notes.push("Some accounts are not reconciled with a statement yet, so their balance may differ from the bank's.");
      break;
    }
    case "category_spend":
    case "merchant_spend": {
      const term = (q.term ?? "").trim();
      if (!term) { f.metric = "unsupported"; f.notes.push("Which category or merchant should I look at?"); f.empty = true; break; }
      const m = matches(term);
      const hit = cur.filter((x) => expenseOf(x) !== 0 && m(x));
      const total = hit.reduce((s, x) => s + expenseOf(x), 0);
      f.figures.push({ key: "matched", label: `Spent on “${term}” (${q.range.label})`, paise: total, tone: "negative" }, { key: "count", label: "Transactions", text: String(hit.length) });
      if (prevRange) cmp("matched", `Spent on “${term}”`, total, prev.filter((x) => m(x)).reduce((s, x) => s + expenseOf(x), 0));
      f.transactions = hit.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(txnLink);
      monthlyChart(`“${term}” by month`, (ts) => [ts.filter(m).reduce((s, x) => s + expenseOf(x), 0)], ["Spent"]);
      f.empty = hit.length === 0;
      if (!hit.length) f.notes.push(`No expenses matching “${term}” were found in this period.`);
      break;
    }
    case "owed_to_me":
    case "i_owe": {
      const dir = q.metric === "owed_to_me" ? "owed_to_me" : "i_owe";
      const list = d.dues.filter((x) => x.direction === dir && x.outstanding > 0 && inWs(q.workspace)(x)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const total = list.reduce((s, x) => s + P(x.outstanding), 0);
      f.period = { from: today, to: today, label: `as of ${fmtDate(today)}` };
      f.figures.push({ key: "outstanding", label: dir === "owed_to_me" ? "Owed to you" : "You owe", paise: total, tone: dir === "owed_to_me" ? "positive" : "negative" });
      f.rowsTitle = dir === "owed_to_me" ? "Who owes you" : "What you owe";
      f.rows = list.slice(0, 10).map((x) => ({ label: x.party, paise: P(x.outstanding), sub: `due ${fmtDate(x.dueDate)}${x.dueDate < today ? " · overdue" : ""}` }));
      f.empty = list.length === 0;
      if (!list.length) f.notes.push(dir === "owed_to_me" ? "No outstanding amounts owed to you are recorded." : "No outstanding loans or dues are recorded.");
      f.notes.push("Based on the loans & dues you have recorded in Money Hub.");
      break;
    }
    case "upcoming_payments": {
      const end = addDays(today, 30);
      const items: FactRow[] = [];
      for (const r of d.recurring) if (inWs(q.workspace)(r) && r.nextDate >= today && r.nextDate <= end) items.push({ label: r.name, paise: P(r.amount), sub: `${fmtDate(r.nextDate)} · ${r.cadence}` });
      for (const x of d.dues) if (x.direction === "i_owe" && x.outstanding > 0 && inWs(q.workspace)(x) && x.dueDate <= end) items.push({ label: x.party, paise: P(x.emi ?? x.outstanding), sub: `${fmtDate(x.dueDate)}${x.dueDate < today ? " · overdue" : ""} · ${x.emi ? "EMI" : "due"}` });
      items.sort((a, b) => (a.sub ?? "").localeCompare(b.sub ?? ""));
      f.period = { from: today, to: end, label: rangeLabel(today, end) };
      f.figures.push({ key: "upcoming", label: "Due in the next 30 days", paise: items.reduce((s, x) => s + x.paise, 0), tone: "negative" }, { key: "count", label: "Payments", text: String(items.length) });
      f.rowsTitle = "Upcoming";
      f.rows = items;
      f.empty = items.length === 0;
      f.notes.push("Only recurring payments and loan/due dates you've recorded are known. Other bills won't appear.");
      break;
    }
    case "increasing_expenses": {
      const pr = prevRange ?? previousPeriod(q.period, q.range);
      f.comparePeriod = pr;
      const deltas = categoryDeltas(cur, scoped.filter(inRange(pr))).filter((x) => x.cur > x.prev && x.cur - x.prev >= 50_000 && (x.prev === 0 || (x.cur - x.prev) / x.prev >= 0.2)).sort((a, b) => b.cur - b.prev - (a.cur - a.prev));
      f.rowsTitle = `Increased vs ${pr.label}`;
      f.rows = deltas.slice(0, 8).map((x) => ({ label: x.category, paise: x.cur, sub: `was ${inr(x.prev)}${x.prev ? ` · +${pct(x.cur, x.prev)}%` : " · new"}` }));
      f.figures.push({ key: "count", label: "Categories that rose 20%+ (and ₹500+)", text: String(deltas.length) });
      f.empty = cur.length === 0;
      if (q.range.partial) f.notes.push("The current period isn't over, so some categories may still rise.");
      break;
    }
    case "recurring_expenses": {
      const rec = d.recurring.filter(inWs(q.workspace));
      const detected = detectRecurring(d.txns, q.workspace, today).filter((x) => !rec.some((r) => r.name.toLowerCase() === x.merchant.toLowerCase()));
      const monthly = (r: RecurringDTO) => P(r.cadence === "yearly" ? r.amount / 12 : r.cadence === "quarterly" ? r.amount / 3 : r.amount);
      f.figures.push({ key: "monthly", label: "Recorded recurring costs per month", paise: rec.reduce((s, r) => s + monthly(r), 0), tone: "negative" });
      f.rowsTitle = "Recurring payments";
      f.rows = [
        ...rec.map((r) => ({ label: r.name, paise: P(r.amount), sub: `${r.cadence} · next ${fmtDate(r.nextDate)}` })),
        ...detected.slice(0, 8).map((x) => ({ label: x.merchant, paise: x.monthly, sub: `seen in ${x.months} of the last 4 months (detected)` })),
      ];
      f.period = { from: today, to: today, label: `as of ${fmtDate(today)}` };
      f.empty = f.rows.length === 0;
      if (detected.length) f.notes.push("“Detected” items are merchants charged at a similar amount in 3+ of the last 4 months. They are not saved as recurring.");
      break;
    }
    case "unnecessary_expenses": {
      const cats = byCategory(cur).filter((r) => DISCRETIONARY.includes(r.category));
      const subs = detectRecurring(d.txns, q.workspace, today);
      f.figures.push({ key: "discretionary", label: `Discretionary spending (${q.range.label})`, paise: cats.reduce((s, r) => s + r.amount, 0), tone: "negative" });
      f.rowsTitle = "Discretionary categories";
      f.rows = cats.map((r) => ({ label: r.category, paise: r.amount }));
      f.transactions = cur.filter((x) => DISCRETIONARY.includes(x.category) && expenseOf(x) > 0).sort((a, b) => expenseOf(b) - expenseOf(a)).slice(0, 5).map(txnLink);
      f.suggestionsBasis = [...cats.slice(0, 3).map((r) => `${r.category}: ${inr(r.amount)}`), ...subs.slice(0, 3).map((s) => `Recurring ${s.merchant}: about ${inr(s.monthly)}/month`)];
      f.empty = cur.length === 0;
      f.notes.push("Money Hub can't know what is necessary for you. These are discretionary categories (food & dining, shopping, entertainment, subscriptions) and repeating charges to review.");
      break;
    }
    case "summary": {
      const t = totals(cur);
      const accs = d.accounts.filter(inWs(q.workspace));
      const cash = accs.filter((a) => a.kind !== "credit_card").reduce((s, a) => s + accountBalance(a.openingBalancePaise, a.id, d.txns), 0);
      const owed = d.dues.filter((x) => x.direction === "owed_to_me" && inWs(q.workspace)(x)).reduce((s, x) => s + P(x.outstanding), 0);
      const owe = d.dues.filter((x) => x.direction === "i_owe" && inWs(q.workspace)(x)).reduce((s, x) => s + P(x.outstanding), 0);
      f.figures.push(
        { key: "income", label: "Income", paise: t.income, tone: "positive" }, { key: "expense", label: "Expenses", paise: t.expense, tone: "negative" },
        { key: "net", label: "Income − expenses", paise: t.net, tone: t.net >= 0 ? "positive" : "negative" },
        { key: "available", label: `Available balance (as of ${fmtDate(today)})`, paise: cash },
        { key: "owed_to_me", label: "Owed to you", paise: owed, tone: "positive" }, { key: "i_owe", label: "You owe", paise: owe, tone: "negative" },
      );
      if (prevRange) cmp("net", "Income − expenses", t.net, totals(prev).net);
      f.rowsTitle = "Top spending";
      f.rows = byCategory(cur).slice(0, 5).map((r) => ({ label: r.category, paise: r.amount }));
      monthlyChart("Income vs expenses", (ts) => { const x = totals(ts); return [x.income, x.expense]; }, ["Income", "Expenses"]);
      f.empty = cur.length === 0 && accs.length === 0;
      break;
    }
    case "unsupported":
      f.empty = true;
      break;
  }
  if (q.metric !== "unsupported" && f.empty && !f.notes.some((n) => n.startsWith("No "))) f.notes.unshift(`No matching records were found for ${label} in ${f.period.label}.`);
  const spanDays = daysBetween(q.range.from, q.range.to);
  if (spanDays > 400 && q.metric !== "balances") f.notes.push("This covers a long period; older months may be incomplete if statements weren't imported.");
  return f;
}
