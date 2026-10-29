import { describe, expect, it } from "vitest";
import { accountBalance, totals } from "@/lib/finance/calc";
import type { Account, Transaction } from "@/lib/finance/types";

const base = { description: "", merchant: "x", category: "c", workspace: "personal" as const, status: "cleared" as const, date: new Date().toISOString() };
const bank: Account = { id: "bank", name: "Bank", institution: "", kind: "bank", workspace: "personal", openingBalance: 10000, reconciled: "never" };
const card: Account = { id: "card", name: "Card", institution: "", kind: "credit_card", workspace: "personal", openingBalance: 0, reconciled: "never" };
const cash: Account = { id: "cash", name: "Cash", institution: "", kind: "cash", workspace: "personal", openingBalance: 0, reconciled: "never" };

describe("finance rules", () => {
  it("transfers between own accounts are not income or expense", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "transfer", amount: 3000, accountId: "bank", toAccountId: "cash" }];
    expect(totals(t)).toMatchObject({ income: 0, expense: 0 });
    expect(accountBalance(bank, t)).toBe(7000);
    expect(accountBalance(cash, t)).toBe(3000);
  });

  it("credit-card purchase counts once; paying the bill is not another expense", () => {
    const t: Transaction[] = [
      { ...base, id: "1", type: "expense", amount: 2000, accountId: "card" },
      { ...base, id: "2", type: "cc_payment", amount: 2000, accountId: "bank", toAccountId: "card" },
    ];
    expect(totals(t).expense).toBe(2000);
    expect(accountBalance(card, t)).toBe(0);
    expect(accountBalance(bank, t)).toBe(8000);
  });

  it("loan repayment counts only interest as an expense", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "loan_repayment", amount: 9450, interest: 2310, accountId: "bank" }];
    expect(totals(t).expense).toBe(2310);
    expect(accountBalance(bank, t)).toBe(550);
  });

  it("loan received is not income", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "loan_disbursement", amount: 25000, accountId: "bank" }];
    expect(totals(t).income).toBe(0);
  });
});
