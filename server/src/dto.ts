import { z } from "zod";
import { TXN_TYPES } from "./domain/ledger.js";
import { toPaise, toRupees } from "./money.js";
import type { AccountRec, TxnInput, TxnRec } from "./repo/types.js";

/** Zod schemas mirror src/lib/finance/types.ts. Amounts arrive in rupees (≤ 2 decimals). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use yyyy-mm-dd").transform((s) => s.slice(0, 10))
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "Invalid date");
const money = z.number().finite();
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable();
const ws = z.string().min(1).max(40);

export const TxnBody = z.object({
  date: isoDate,
  type: z.enum(TXN_TYPES as [string, ...string[]]),
  amount: money.positive("Amount must be greater than zero"),
  adjustmentSign: opt(z.union([z.literal(1), z.literal(-1)])),
  description: z.string().max(255).default(""),
  merchant: z.string().max(160).default(""),
  category: z.string().min(1).max(80),
  subcategory: opt(z.string().max(80)),
  workspace: ws,
  accountId: z.string().min(1),
  toAccountId: opt(z.string().min(1)),
  interest: opt(money.nonnegative()),
  client: opt(z.string().max(160)),
  project: opt(z.string().max(160)),
  notes: opt(z.string().max(5000)),
  status: z.enum(["cleared", "pending"]).default("cleared"),
  recurring: opt(z.boolean()),
  source: opt(z.enum(["manual", "statement", "demo"])),
  ref: opt(z.string().trim().min(1).max(120)),
}).strip();
export type TxnBodyT = z.infer<typeof TxnBody>;

export function txnFromBody(b: TxnBodyT): TxnInput {
  return {
    date: b.date, type: b.type as TxnInput["type"], amountPaise: toPaise(b.amount),
    adjustmentSign: b.type === "adjustment" ? (b.adjustmentSign ?? 1) : null,
    interestPaise: b.type === "loan_repayment" && b.interest != null ? toPaise(b.interest) : null,
    description: b.description, merchant: b.merchant, category: b.category, subcategory: b.subcategory ?? null,
    workspace: b.workspace, accountId: b.accountId,
    toAccountId: b.type === "transfer" || b.type === "cc_payment" ? (b.toAccountId ?? null) : null,
    client: b.client ?? null, project: b.project ?? null, notes: b.notes ?? null, status: b.status,
    recurring: b.recurring ?? false, source: b.source === "demo" ? "manual" : (b.source ?? "manual"), ref: b.ref ?? null,
  };
}

const u = <T>(v: T | null | undefined) => (v == null ? undefined : v);
export function txnToDto(t: TxnRec) {
  return {
    id: t.id, date: t.date, type: t.type, amount: toRupees(t.amountPaise), adjustmentSign: u(t.adjustmentSign),
    description: t.description, merchant: t.merchant, category: t.category, subcategory: u(t.subcategory), workspace: t.workspace,
    accountId: t.accountId, toAccountId: u(t.toAccountId), interest: t.interestPaise == null ? undefined : toRupees(t.interestPaise),
    client: u(t.client), project: u(t.project), notes: u(t.notes), status: t.status, recurring: t.recurring, source: t.source, ref: u(t.ref),
  };
}
/** Back to body shape so PATCH can merge then fully re-validate. */
export function txnToBody(t: TxnRec): TxnBodyT {
  const d = txnToDto(t);
  return { ...d, source: d.source } as TxnBodyT;
}

export const AccountBody = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  institution: z.string().max(120).default(""),
  kind: z.enum(["bank", "cash", "upi", "credit_card", "wallet"]),
  workspace: ws,
  openingBalance: money,
  last4: opt(z.string().regex(/^\d{4}$/)),
  creditLimit: opt(money.nonnegative()),
  reconciled: z.enum(["reconciled", "pending", "never"]).default("never"),
}).strip();
export function accountFromBody(a: z.infer<typeof AccountBody>): AccountRec {
  return {
    id: a.id, name: a.name, institution: a.institution, kind: a.kind, workspace: a.workspace, openingBalancePaise: toPaise(a.openingBalance),
    last4: a.last4 ?? null, creditLimitPaise: a.creditLimit == null ? null : toPaise(a.creditLimit), reconciled: a.reconciled,
  };
}
export function accountToDto(a: AccountRec) {
  return {
    id: a.id, name: a.name, institution: a.institution, kind: a.kind, workspace: a.workspace, openingBalance: toRupees(a.openingBalancePaise),
    last4: u(a.last4), creditLimit: a.creditLimitPaise == null ? undefined : toRupees(a.creditLimitPaise), reconciled: a.reconciled,
  };
}

const dp2 = (n: number) => { try { toPaise(n); return true; } catch { return false; } };
const twoDp = { positive: () => money.positive().refine(dp2, "Max 2 decimals"), nonnegative: () => money.nonnegative().refine(dp2, "Max 2 decimals") };
export const CollectionSchemas = {
  dues: z.array(z.object({
    id: z.string(), direction: z.enum(["i_owe", "owed_to_me"]), kind: z.enum(["loan", "personal", "client", "emi"]), party: z.string().min(1).max(160),
    principal: twoDp.nonnegative(), outstanding: twoDp.nonnegative(), dueDate: isoDate, interestRate: z.number().min(0).max(100).optional(),
    emi: twoDp.nonnegative().optional(), workspace: ws, notes: z.string().max(5000).optional(),
    payments: z.array(z.object({ date: isoDate, amount: twoDp.positive(), interest: twoDp.nonnegative().optional() })).default([]),
  }).strip()),
  budgets: z.array(z.object({ id: z.string(), category: z.string().min(1).max(80), workspace: ws, limit: twoDp.positive() }).strip()),
  goals: z.array(z.object({ id: z.string(), name: z.string().min(1).max(120), target: twoDp.positive(), saved: twoDp.nonnegative(), deadline: isoDate }).strip()),
  recurring: z.array(z.object({ id: z.string(), name: z.string().min(1).max(120), amount: twoDp.positive(), category: z.string().min(1).max(80), workspace: ws, nextDate: isoDate, cadence: z.enum(["monthly", "yearly", "quarterly"]) }).strip()),
  rules: z.array(z.object({ id: z.string(), match: z.string().min(1).max(120), category: z.string().min(1).max(80), workspace: ws, priority: z.number().int(), enabled: z.boolean() }).strip()),
  customCategories: z.array(z.string().trim().min(1).max(80)),
} as const;
