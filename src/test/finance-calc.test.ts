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

import { dedupe, byCategory, matchDuplicate, netOf } from "@/lib/finance/calc";

describe("phase 1.5 regressions", () => {
  it("card refund reduces spending and card balance owed", () => {
    const t: Transaction[] = [
      { ...base, id: "1", type: "expense", amount: 5000, accountId: "card" },
      { ...base, id: "2", type: "refund", amount: 1500, accountId: "card" },
    ];
    expect(totals(t).expense).toBe(3500);
    expect(accountBalance(card, t)).toBe(-3500);
  });

  it("personal to business transfer is neither business income nor personal expense", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "transfer", amount: 20000, accountId: "bank", toAccountId: "biz", workspace: "personal" }];
    expect(totals(t)).toMatchObject({ income: 0, expense: 0, bizIncome: 0, bizExpense: 0 });
  });

  it("business profit uses only business income and expenses", () => {
    const t: Transaction[] = [
      { ...base, id: "1", type: "income", amount: 80000, accountId: "biz", workspace: "scaleflow" },
      { ...base, id: "2", type: "expense", amount: 12000, accountId: "biz", workspace: "scaleflow" },
      { ...base, id: "3", type: "expense", amount: 3000, accountId: "bank" },
    ];
    expect(totals(t)).toMatchObject({ bizProfit: 68000, expense: 15000, income: 80000 });
  });

  it("negative adjustment lowers balance without being an expense", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "adjustment", amount: 400, adjustmentSign: -1, accountId: "bank" }];
    expect(accountBalance(bank, t)).toBe(9600);
    expect(totals(t).expense).toBe(0);
  });

  it("re-importing rows with the same bank reference adds nothing", () => {
    const row = { ...base, type: "expense" as const, amount: 499, merchant: "Swiggy", accountId: "bank", ref: "UTR1" };
    expect(dedupe([row], [{ ...row, id: "a" }])).toEqual({ fresh: [], skipped: 1 });
    expect(dedupe([row, row], []).fresh).toHaveLength(1);
  });

  it("two real payments with same date, merchant and amount but different references are both kept", () => {
    const a = { ...base, type: "expense" as const, amount: 1999, merchant: "Hostinger", accountId: "bank", ref: "UTR1" };
    const b = { ...a, ref: "UTR2" };
    expect(matchDuplicate(b, [a])).toBe("none");
    expect(dedupe([b], [{ ...a, id: "x" }]).fresh).toHaveLength(1);
  });

  it("look-alike rows without references are flagged, not discarded", () => {
    const a = { ...base, type: "expense" as const, amount: 1999, merchant: "Hostinger", accountId: "bank" };
    expect(matchDuplicate(a, [a])).toBe("possible");
    expect(dedupe([a], [{ ...a, id: "x" }]).fresh).toHaveLength(1);
  });

  it("same merchant and amount on a different account is not a duplicate", () => {
    const a = { ...base, type: "expense" as const, amount: 300, merchant: "Uber", accountId: "bank" };
    expect(matchDuplicate({ ...a, accountId: "cash" }, [a])).toBe("none");
  });

  it("editing and deleting recalculate totals", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "expense", amount: 1000, accountId: "bank" }, { ...base, id: "2", type: "income", amount: 5000, accountId: "bank" }];
    const edited = t.map((x) => (x.id === "1" ? { ...x, amount: 1500 } : x));
    expect(netOf(edited)).toBe(3500);
    expect(netOf(edited.filter((x) => x.id !== "2"))).toBe(-1500);
    expect(accountBalance(bank, edited)).toBe(13500);
  });

  it("refund-only category never shows negative spending", () => {
    const t: Transaction[] = [{ ...base, id: "1", type: "refund", amount: 700, accountId: "bank", category: "Shopping" }];
    expect(byCategory(t)).toEqual([]);
  });
});
