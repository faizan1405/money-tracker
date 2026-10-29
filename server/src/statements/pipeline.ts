import { randomUUID } from "node:crypto";
import { categorizeWithAi, type AiType } from "../ai/categorize.js";
import { AiError, type OpenRouterClient } from "../ai/openrouter.js";
import type { DupMatch } from "../domain/ledger.js";
import type { AccountRec, RuleDTO, TxnRec, WorkspaceRec } from "../repo/types.js";
import { maskForAi, type ParsedStatement } from "./parse.js";
import type { ImportSummary, Reconciliation, ReviewRow } from "./types.js";

export interface PipelineCtx {
  account: AccountRec;
  workspaces: WorkspaceRec[];
  rules: RuleDTO[];
  ledger: TxnRec[];
  categories: string[];
  ai: OpenRouterClient | null;
  maxAiRows: number;
  ownerId?: string;
}

const CREDIT_TYPES = new Set(["income", "refund", "transfer", "loan_disbursement"]);
const DEBIT_TYPES = new Set(["expense", "transfer", "loan_repayment", "cc_payment"]);

/** Opening + credits − debits must equal closing; each running balance must follow from the previous one. */
export function reconcile(p: ParsedStatement): Reconciliation {
  let credits = 0, debits = 0, unclear = false;
  for (const r of p.rows) {
    if (r.direction === "credit") credits += r.amountPaise;
    else if (r.direction === "debit") debits += r.amountPaise;
    else unclear = true;
  }
  const brokenRows: number[] = [];
  let prev = p.openingPaise;
  for (const r of p.rows) {
    if (r.balancePaise === undefined) continue;
    if (prev !== undefined && r.direction !== "unknown") {
      const exp = prev + (r.direction === "credit" ? r.amountPaise : -r.amountPaise);
      if (exp !== r.balancePaise) brokenRows.push(r.line);
    }
    prev = r.balancePaise;
  }
  const base = { creditsPaise: credits, debitsPaise: debits, brokenRows, ...(p.openingPaise !== undefined ? { openingPaise: p.openingPaise } : {}), ...(p.closingPaise !== undefined ? { closingPaise: p.closingPaise } : {}) };
  if (p.openingPaise === undefined || p.closingPaise === undefined) return { ...base, status: brokenRows.length ? "mismatch" : unclear ? "unclear" : "unavailable" };
  if (unclear) return { ...base, status: "unclear" };
  const differencePaise = p.closingPaise - (p.openingPaise + credits - debits);
  return { ...base, differencePaise, status: differencePaise === 0 && !brokenRows.length ? "balanced" : "mismatch" };
}

const ruleFor = (rules: RuleDTO[], text: string) =>
  [...rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority).find((r) => text.toLowerCase().includes(r.match.toLowerCase()));

export async function buildReview(p: ParsedStatement, ctx: PipelineCtx): Promise<{ rows: ReviewRow[]; summary: ImportSummary }> {
  const acc = ctx.account;
  const business = ctx.workspaces.filter((w) => w.kind === "business");
  const rows: ReviewRow[] = p.rows.map((r) => ({
    id: randomUUID(), line: r.line, date: r.date, description: r.description.slice(0, 255), direction: r.direction, amountPaise: r.amountPaise,
    ...(r.time ? { time: r.time } : {}), ...(r.ref ? { ref: r.ref.slice(0, 120) } : {}), ...(r.balancePaise !== undefined ? { balancePaise: r.balancePaise } : {}),
    suggestion: { type: r.direction === "credit" ? "income" : "expense", category: "Other", subcategory: "", merchant: "", workspace: acc.workspace },
    confidence: 0, source: "none", reason: "", flags: [], duplicate: "none",
  }));

  // 1) Duplicates: against the ledger for this account, then within the file itself.
  const accLedger = ctx.ledger.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id);
  const seenRefs = new Map<string, string>();
  const seenLook = new Set<string>();
  for (const r of rows) {
    let best: DupMatch = "none";
    for (const t of accLedger) {
      if (r.ref && t.ref) { // both have bank references: same = already imported, different = never a duplicate
        if (r.ref === t.ref && t.accountId === acc.id) { best = "exact"; r.matchedTransactionId = t.id; break; }
        continue;
      }
      if (t.date === r.date && t.amountPaise === r.amountPaise && best === "none") { best = "possible"; r.matchedTransactionId = t.id; }
    }
    if (best !== "exact" && r.ref) {
      if (seenRefs.has(r.ref)) { best = "exact"; r.flags.push("Same bank reference appears twice in this file"); }
      seenRefs.set(r.ref, r.id);
    }
    if (best === "none" && !r.ref) {
      const k = `${r.date}|${r.amountPaise}|${r.direction}|${r.description.toLowerCase()}`;
      if (seenLook.has(k)) { best = "possible"; r.flags.push("Looks identical to another row in this file — keep both if they are real repeat payments"); }
      seenLook.add(k);
    }
    r.duplicate = best;
    if (best === "possible") r.flags.push("Possible duplicate of an existing transaction");
  }

  // 2) Saved rules first (no AI call needed).
  const needAi: ReviewRow[] = [];
  for (const r of rows) {
    if (r.duplicate === "exact") continue;
    const rule = ruleFor(ctx.rules, r.description);
    if (rule) {
      r.suggestion.category = rule.category;
      r.suggestion.workspace = rule.workspace;
      r.suggestion.merchant = rule.match;
      r.source = "rule"; r.confidence = 0.95; r.reason = `Matches your rule "${rule.match}"`;
    } else needAi.push(r);
  }

  // 3) AI categorisation of the remainder (masked narration + direction only).
  let ai: ImportSummary["ai"] = { status: needAi.length ? "not_configured" : "not_needed" };
  if (needAi.length && ctx.ai) {
    try {
      const batch = needAi.slice(0, ctx.maxAiRows);
      const res = await categorizeWithAi(ctx.ai, batch.map((r, i) => ({ i, d: maskForAi(r.description), dir: r.direction })), ctx.categories, business.map((b) => b.name), ctx.ownerId ? { ownerId: ctx.ownerId, feature: "statement" } : undefined);
      for (const s of res.items) {
        const r = batch[s.i];
        if (!r) continue;
        applySuggestion(r, s.type, s, acc, business);
      }
      ai = { status: "used", model: res.model, costUsd: res.costUsd, calls: res.calls, ...(needAi.length > batch.length ? { message: `Only the first ${batch.length} rows were sent to AI.` } : {}) };
    } catch (e) {
      ai = { status: "failed", message: e instanceof AiError ? e.message : "AI categorisation failed." };
    }
  } else if (needAi.length) ai = { status: "not_configured", message: "AI isn't set up on this server, so rows without a matching rule need a category." };

  // 4) Review flags.
  for (const r of rows) {
    if (r.direction === "unknown") r.flags.push("Couldn't tell if money came in or went out");
    if (r.duplicate !== "exact" && r.source === "none") r.flags.push("Needs a category");
    if (r.source === "ai" && r.confidence < 0.7) r.flags.push("AI wasn't confident");
    if (r.suggestion.type === "transfer" || r.suggestion.type === "cc_payment") r.flags.push("Confirm the other account for this transfer");
    if (r.suggestion.type === "loan_repayment") r.flags.push("Confirm loan payment; interest is not split automatically");
    if (r.suggestion.workspace !== acc.workspace) r.flags.push("Suggested for a different workspace than this account");
  }

  const rec = reconcile(p);
  for (const r of rows) if (rec.brokenRows.includes(r.line)) r.flags.push("Running balance doesn't follow from the previous row");
  const accountMatches = p.accountLast4 && acc.last4 ? p.accountLast4 === acc.last4 : undefined;
  const warnings = [...p.warnings];
  if (accountMatches === false) warnings.unshift(`This statement is for an account ending ${p.accountLast4}, but you chose ${acc.name} (••${acc.last4}).`);
  if (rec.status === "mismatch") warnings.unshift("Statement totals don't add up — some rows may be missing or misread.");
  return {
    rows,
    summary: {
      found: rows.length, duplicates: rows.filter((r) => r.duplicate !== "none").length, flagged: rows.filter((r) => r.flags.length).length,
      ...(p.period ? { period: p.period } : {}), ...(p.accountLast4 ? { accountLast4: p.accountLast4 } : {}), ...(accountMatches !== undefined ? { accountMatches } : {}),
      reconciliation: rec, ai, warnings: warnings.slice(0, 30),
    },
  };
}

function applySuggestion(r: ReviewRow, type: AiType, s: { category: string; subcategory: string; merchant: string; scope: string; confidence: number; reason: string }, acc: AccountRec, business: WorkspaceRec[]) {
  let t: string = type;
  let conf = s.confidence;
  const allowed = r.direction === "credit" ? CREDIT_TYPES : r.direction === "debit" ? DEBIT_TYPES : null;
  if (allowed && !allowed.has(t)) { // AI contradicts the statement's direction → statement wins
    r.flags.push(`AI suggested "${t}" but the statement shows money ${r.direction === "credit" ? "in" : "out"}`);
    t = r.direction === "credit" ? "income" : "expense";
    conf = Math.min(conf, 0.4);
  }
  let workspace = acc.workspace;
  if (s.scope === "business" && acc.workspace === "personal" && business.length === 1) workspace = business[0]!.key;
  if (s.scope === "personal" && acc.workspace !== "personal") workspace = "personal";
  r.suggestion = { type: t, category: s.category || "Other", subcategory: s.subcategory, merchant: s.merchant, workspace };
  r.confidence = Math.round(conf * 100) / 100;
  r.reason = s.reason;
  r.source = "ai";
}
