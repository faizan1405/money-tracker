/**
 * Server copy of the frontend finance rules (src/lib/finance/calc.ts), in integer paise.
 * Keep the two in sync: transfers, card bill payments and loan principal are never income/expense.
 */
export type TxnType = "income" | "expense" | "transfer" | "refund" | "loan_disbursement" | "loan_repayment" | "cc_payment" | "adjustment";
export const TXN_TYPES: TxnType[] = ["income", "expense", "transfer", "refund", "loan_disbursement", "loan_repayment", "cc_payment", "adjustment"];

export interface LedgerTxn {
  id: string;
  date: string; // yyyy-mm-dd
  type: TxnType;
  amountPaise: number; // > 0
  adjustmentSign?: 1 | -1 | null;
  interestPaise?: number | null;
  workspace: string;
  accountId: string;
  toAccountId?: string | null;
  category: string;
  merchant: string;
  ref?: string | null;
}

export function incomeOf(t: LedgerTxn): number {
  return t.type === "income" ? t.amountPaise : 0;
}

export function expenseOf(t: LedgerTxn): number {
  if (t.type === "expense") return t.amountPaise;
  if (t.type === "refund") return -t.amountPaise;
  if (t.type === "loan_repayment") return t.interestPaise ?? 0;
  return 0;
}

export function balanceEffect(t: LedgerTxn, accountId: string): number {
  let d = 0;
  if (t.accountId === accountId) {
    switch (t.type) {
      case "income":
      case "refund":
      case "loan_disbursement":
        d += t.amountPaise;
        break;
      case "adjustment":
        d += t.amountPaise * (t.adjustmentSign ?? 1);
        break;
      default:
        d -= t.amountPaise;
    }
  }
  if (t.toAccountId === accountId && (t.type === "transfer" || t.type === "cc_payment")) d += t.amountPaise;
  return d;
}

export function accountBalance(openingPaise: number, accountId: string, txns: LedgerTxn[]): number {
  return txns.reduce((s, t) => s + balanceEffect(t, accountId), openingPaise);
}

export function totals(txns: LedgerTxn[]) {
  let income = 0, expense = 0, bizIncome = 0, bizExpense = 0;
  for (const t of txns) {
    const i = incomeOf(t), x = expenseOf(t);
    income += i;
    expense += x;
    if (t.workspace !== "personal") { bizIncome += i; bizExpense += x; }
  }
  return { income, expense, net: income - expense, bizIncome, bizExpense, bizProfit: bizIncome - bizExpense };
}

export function byCategory(txns: LedgerTxn[]) {
  const m = new Map<string, number>();
  for (const t of txns) {
    const x = expenseOf(t);
    if (x) m.set(t.category, (m.get(t.category) ?? 0) + x);
  }
  return [...m].map(([category, amount]) => ({ category, amount })).filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
}

export function byMonth(txns: LedgerTxn[]) {
  const m = new Map<string, { income: number; expense: number }>();
  for (const t of txns) {
    const k = t.date.slice(0, 7);
    const r = m.get(k) ?? { income: 0, expense: 0 };
    r.income += incomeOf(t);
    r.expense += expenseOf(t);
    m.set(k, r);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, ...r }));
}

export type DupMatch = "exact" | "possible" | "none";

/** Same rule as the frontend: same ref = exact; different refs = never; no refs + same day/amount/merchant = possible. */
export function compareTxn(t: Omit<LedgerTxn, "id">, x: Omit<LedgerTxn, "id">): DupMatch {
  if (t.accountId !== x.accountId && t.accountId !== x.toAccountId) return "none";
  if (t.ref && x.ref) return t.ref === x.ref ? "exact" : "none";
  const same = x.date === t.date && x.amountPaise === t.amountPaise && x.merchant.trim().toLowerCase() === t.merchant.trim().toLowerCase();
  return same ? "possible" : "none";
}

export function matchDuplicate(t: Omit<LedgerTxn, "id">, ledger: Omit<LedgerTxn, "id">[]): DupMatch {
  let best: DupMatch = "none";
  for (const x of ledger) {
    const r = compareTxn(t, x);
    if (r === "exact") return "exact";
    if (r === "possible") best = "possible";
  }
  return best;
}
