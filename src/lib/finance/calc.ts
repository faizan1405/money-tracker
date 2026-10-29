import type { Account, Period, Transaction, WorkspaceFilter } from "./types";

/** Money that is genuinely earned. Transfers, loans received and refunds are NOT income. */
export function incomeOf(t: Transaction) {
  return t.type === "income" ? t.amount : 0;
}

/**
 * Money genuinely spent. Expenses count once (incl. credit-card purchases).
 * Refunds reduce spending. Credit-card bill payments, transfers and loan principal are excluded;
 * only the interest part of a loan repayment counts as an expense.
 */
export function expenseOf(t: Transaction) {
  if (t.type === "expense") return t.amount;
  if (t.type === "refund") return -t.amount;
  if (t.type === "loan_repayment") return t.interest ?? 0;
  return 0;
}

/** Signed effect of a transaction on one account's balance. */
export function balanceEffect(t: Transaction, accountId: string) {
  let d = 0;
  if (t.accountId === accountId) {
    switch (t.type) {
      case "income":
      case "refund":
      case "loan_disbursement":
        d += t.amount;
        break;
      case "adjustment":
        d += t.amount * (t.adjustmentSign ?? 1);
        break;
      default:
        d -= t.amount;
    }
  }
  if (t.toAccountId === accountId && (t.type === "transfer" || t.type === "cc_payment")) d += t.amount;
  return d;
}

export function accountBalance(acc: Account, txns: Transaction[]) {
  return txns.reduce((s, t) => s + balanceEffect(t, acc.id), acc.openingBalance);
}

export function inWorkspace(t: { workspace: string }, ws: WorkspaceFilter) {
  return ws === "all" || t.workspace === ws;
}

export function periodRange(p: Period, now = new Date(), custom?: { from: string; to: string }): [Date, Date] {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case "week": {
      const s = new Date(now);
      s.setDate(now.getDate() - 6);
      s.setHours(0, 0, 0, 0);
      return [s, endOfDay(now)];
    }
    case "month":
      return [new Date(y, m, 1), endOfDay(now)];
    case "last_month":
      return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999)];
    case "year":
      return [new Date(y, 0, 1), endOfDay(now)];
    case "custom":
      return [new Date(custom?.from ?? y + "-01-01"), endOfDay(new Date(custom?.to ?? now))];
  }
}

export function previousRange([s, e]: [Date, Date]): [Date, Date] {
  const len = e.getTime() - s.getTime();
  return [new Date(s.getTime() - len - 1), new Date(s.getTime() - 1)];
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function inRange(t: Transaction, [s, e]: [Date, Date]) {
  const d = new Date(t.date).getTime();
  return d >= s.getTime() && d <= e.getTime();
}

export function totals(txns: Transaction[]) {
  let income = 0;
  let expense = 0;
  let bizIncome = 0;
  let bizExpense = 0;
  for (const t of txns) {
    const i = incomeOf(t);
    const x = expenseOf(t);
    income += i;
    expense += x;
    if (t.workspace !== "personal") {
      bizIncome += i;
      bizExpense += x;
    }
  }
  return { income, expense, net: income - expense, bizProfit: bizIncome - bizExpense, bizIncome, bizExpense };
}

export function byCategory(txns: Transaction[]) {
  const m = new Map<string, number>();
  for (const t of txns) {
    const x = expenseOf(t);
    if (x) m.set(t.category, (m.get(t.category) ?? 0) + x);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
}

export function monthly(txns: Transaction[], months = 6, now = new Date()) {
  const rows: { key: string; label: string; income: number; expense: number; net: number; personal: number; business: number; profit: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    rows.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-IN", { month: "short" }), income: 0, expense: 0, net: 0, personal: 0, business: 0, profit: 0 });
  }
  const idx = new Map(rows.map((r, i) => [r.key, i]));
  for (const t of txns) {
    const d = new Date(t.date);
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i === undefined) continue;
    const r = rows[i];
    if (!r) continue;
    const inc = incomeOf(t);
    const exp = expenseOf(t);
    r.income += inc;
    r.expense += exp;
    if (t.workspace === "personal") r.personal += exp;
    else {
      r.business += exp;
      r.profit += inc - exp;
    }
  }
  rows.forEach((r) => (r.net = r.income - r.expense));
  return rows;
}

export function toCSV(txns: Transaction[], accounts: Account[]) {
  const name = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "";
  const head = ["Date", "Type", "Merchant", "Description", "Category", "Workspace", "Account", "To Account", "Amount", "Status"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = txns.map((t) =>
    [t.date, t.type, t.merchant, t.description, t.category, t.workspace, name(t.accountId), name(t.toAccountId), t.amount, t.status].map(esc).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
