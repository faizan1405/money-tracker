import { createHash } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { OpenRouterClient } from "../ai/openrouter.js";
import type { AppConfig } from "../config.js";
import { TxnBody, txnFromBody } from "../dto.js";
import { HttpError, ah } from "../http.js";
import { toRupees } from "../money.js";
import type { Repo, RuleDTO, TxnInput } from "../repo/types.js";
import { pdfToText } from "./pdf.js";
import { StatementParseError, parseCsv, parseStatementText, type ParsedStatement } from "./parse.js";
import { buildReview } from "./pipeline.js";
import type { ImportRec, ReviewRow } from "./types.js";

interface Deps {
  repo: Repo;
  config: AppConfig;
  ai: OpenRouterClient | null;
  owner: (req: Request) => string;
  validate: (ownerId: string, items: TxnInput[]) => Promise<void>;
}

/** Same names as the app's built-in categories (src/lib/finance/data.ts) plus a few statement-specific ones. */
export const DEFAULT_CATEGORIES = [
  "Food & Dining", "Groceries", "Shopping", "Transport", "Bills & Utilities", "Rent", "Health", "Education", "Entertainment", "Subscriptions",
  "Meta Ads", "Hosting & Domains", "Software & Tools", "Freelancer Payments", "Salaries", "Marketing", "Client Project Costs", "Office Expenses", "Other Business Expenses",
  "Client Payment", "Salary", "Freelance", "Business Revenue", "Interest", "Other Income",
  "Transfer", "Card Payment", "Loan", "Refund", "Cash Withdrawal", "Bank Charges", "Fuel", "Travel", "Insurance", "Investments", "Taxes", "Other",
];

const importDto = (i: ImportRec) => ({
  id: i.id, fileName: i.fileName, accountId: i.accountId, workspace: i.workspace, status: i.status, createdAt: i.createdAt,
  ...(i.error ? { error: i.error } : {}),
  ...(i.summary ? { summary: {
    ...i.summary,
    reconciliation: {
      status: i.summary.reconciliation.status, brokenRows: i.summary.reconciliation.brokenRows,
      credits: toRupees(i.summary.reconciliation.creditsPaise), debits: toRupees(i.summary.reconciliation.debitsPaise),
      ...(i.summary.reconciliation.openingPaise !== undefined ? { opening: toRupees(i.summary.reconciliation.openingPaise) } : {}),
      ...(i.summary.reconciliation.closingPaise !== undefined ? { closing: toRupees(i.summary.reconciliation.closingPaise) } : {}),
      ...(i.summary.reconciliation.differencePaise !== undefined ? { difference: toRupees(i.summary.reconciliation.differencePaise) } : {}),
    },
  } } : {}),
});

const rowDto = (importId: string, accountId: string, r: ReviewRow) => ({
  id: r.id, importId, line: r.line, date: r.date, time: r.time, direction: r.direction, amount: toRupees(r.amountPaise), ref: r.ref,
  balance: r.balancePaise === undefined ? undefined : toRupees(r.balancePaise), description: r.description,
  proposed: {
    date: r.date, type: r.suggestion.type, amount: toRupees(r.amountPaise), description: r.description, merchant: r.suggestion.merchant || r.description.slice(0, 60),
    category: r.suggestion.category, subcategory: r.suggestion.subcategory || undefined, workspace: r.suggestion.workspace, accountId, status: "cleared", source: "statement", ref: r.ref,
  },
  confidence: r.confidence, reason: r.reason, source: r.source, flags: r.flags, duplicate: r.duplicate, matchedTransactionId: r.matchedTransactionId,
});

const Decision = z.object({
  id: z.string().min(1),
  decision: z.enum(["accept", "skip"]),
  remember: z.boolean().optional(),
  edited: z.object({
    type: z.enum(["income", "expense", "transfer", "refund", "loan_repayment", "loan_disbursement", "cc_payment"]).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    subcategory: z.string().max(80).optional(),
    merchant: z.string().max(160).optional(),
    description: z.string().max(255).optional(),
    workspace: z.string().min(1).max(40).optional(),
    otherAccountId: z.string().min(1).optional(),
    interest: z.number().nonnegative().optional(),
  }).strip().optional(),
});

export function registerStatementRoutes(app: Express, { repo, config, ai, owner, validate }: Deps) {
  // Memory storage: the file lives only in RAM for this request — never written to disk or third-party storage.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 6 } });
  const single = (req: Request, res: Response, next: NextFunction) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) return next(new HttpError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.code === "LIMIT_FILE_SIZE" ? `File is larger than ${Math.round(config.uploadMaxBytes / 1048576)} MB` : "Upload failed", "bad_upload"));
      next(err as Error | undefined);
    });

  app.get("/api/statements", ah(async (req, res) => { res.json((await repo.listImports(owner(req))).map(importDto)); }));

  app.post("/api/statements", single, ah(async (req, res) => {
    const id = owner(req);
    const f = req.file;
    if (!f) throw new HttpError(422, "Choose a statement file", "validation");
    const fields = z.object({ accountId: z.string().min(1), workspace: z.string().optional(), password: z.string().max(200).optional() }).parse(req.body);
    const account = (await repo.listAccounts(id)).find((a) => a.id === fields.accountId);
    if (!account) throw new HttpError(422, "Account not found", "validation");
    const name = f.originalname.slice(0, 200).replace(/[^\w .()-]/g, "_");
    const ext = name.toLowerCase().split(".").pop();
    const fileHash = createHash("sha256").update(f.buffer).digest("hex");

    let parsed: ParsedStatement;
    try {
      if (ext === "pdf") {
        const { text } = await pdfToText(f.buffer, fields.password || undefined);
        parsed = parseStatementText(text);
      } else if (ext === "csv" || ext === "txt") {
        const text = f.buffer.toString("utf8");
        if (text.includes("\u0000")) throw new StatementParseError("This doesn't look like a text CSV file.", "unreadable");
        parsed = parseCsv(text);
      } else {
        throw new HttpError(415, "Upload a PDF or CSV statement. Excel and photos aren't supported yet — export CSV from your bank instead.", "unsupported_file");
      }
    } catch (e) {
      if (e instanceof StatementParseError) throw new HttpError(422, e.message, e.code);
      throw e;
    } finally {
      f.buffer.fill(0); // drop file contents (and any decrypted data) as soon as parsing ends
    }
    if (parsed.rows.length > 5000) throw new HttpError(422, "This statement has too many rows. Split it into smaller periods.", "too_many_rows");

    const [workspaces, rules, { items: ledger }, cats] = await Promise.all([
      repo.listWorkspaces(id), repo.getCollection(id, "rules"), repo.listTxns(id, { accountId: account.id }), repo.listCategories(id),
    ]);
    const categories = [...new Set([...DEFAULT_CATEGORIES, ...cats.map((c) => c.name), ...(await repo.getCollection(id, "customCategories"))])];
    const { rows, summary } = await buildReview(parsed, { account, workspaces, rules, ledger, categories, ai, maxAiRows: config.aiMaxRows ?? 400 });
    const before = await repo.findImportsByHash(id, account.id, fileHash);
    if (before.some((b) => b.status === "completed")) { summary.sameFileImportedBefore = true; summary.warnings.unshift("You've already imported this exact file into this account."); }
    // Supersede any earlier pending review of the same file so it can't be approved twice.
    for (const b of before) if (b.status === "needs_review") await repo.updateImport(id, b.id, { status: "failed", error: "Replaced by a newer upload of the same file", rows: null });
    const imp = await repo.createImport(id, { accountId: account.id, workspace: account.workspace, fileName: name, fileHash, status: "needs_review", summary, rows });
    await repo.audit(id, "statement.upload", "statement", imp.id, { rows: rows.length, ai: summary.ai.status, costUsd: summary.ai.costUsd ?? 0 }, req.ip);
    res.status(201).json(importDto(imp));
  }));

  const load = async (req: Request) => {
    const imp = await repo.getImport(owner(req), String(req.params.id));
    if (!imp) throw new HttpError(404, "Statement not found", "not_found");
    return imp;
  };
  app.get("/api/statements/:id", ah(async (req, res) => { res.json(importDto(await load(req))); }));
  app.get("/api/statements/:id/review", ah(async (req, res) => {
    const imp = await load(req);
    res.json((imp.rows ?? []).map((r) => rowDto(imp.id, imp.accountId, r)));
  }));
  app.post("/api/statements/:id/discard", ah(async (req, res) => {
    const imp = await load(req);
    if (imp.status !== "needs_review") throw new HttpError(409, "Only a statement waiting for review can be discarded", "conflict");
    res.json(importDto(await repo.updateImport(owner(req), imp.id, { status: "failed", error: "Discarded", rows: null })));
  }));

  app.post("/api/statements/:id/review", ah(async (req, res) => {
    const id = owner(req);
    const imp = await load(req);
    if (imp.status !== "needs_review") throw new HttpError(409, "This statement has already been saved or discarded", "conflict");
    const { decisions } = z.object({ decisions: z.array(Decision).min(1).max(5000) }).parse(req.body);
    const rows = new Map((imp.rows ?? []).map((r) => [r.id, r]));
    const accepted: TxnInput[] = [];
    const learn: { match: string; category: string; workspace: string }[] = [];
    decisions.forEach((d, i) => {
      const r = rows.get(d.id);
      const bad = (message: string) => { throw new HttpError(422, message, "validation", [{ field: `decisions.${i}`, message }]); };
      if (!r) return bad("Row not found in this statement");
      if (d.decision === "skip") return;
      if (r.duplicate === "exact") return bad(`Row ${r.line} is already in your records`);
      const e = d.edited ?? {};
      const type = e.type ?? r.suggestion.type;
      const dir = r.direction !== "unknown" ? r.direction : ["income", "refund", "loan_disbursement"].includes(type) ? "credit" : ["transfer", "cc_payment"].includes(type) ? null : "debit";
      if (!dir) return bad(`Row ${r.line}: say whether money came in or went out`);
      const transferish = type === "transfer" || type === "cc_payment";
      if (transferish && !e.otherAccountId) return bad(`Row ${r.line}: choose the other account for this transfer`);
      const inbound = dir === "credit";
      const merchant = (e.merchant ?? r.suggestion.merchant) || r.description.slice(0, 60);
      const category = e.category ?? r.suggestion.category;
      const body = TxnBody.parse({
        date: r.date, type, amount: toRupees(r.amountPaise), description: e.description ?? r.description, merchant, category,
        subcategory: (e.subcategory ?? r.suggestion.subcategory) || null, workspace: e.workspace ?? r.suggestion.workspace,
        accountId: transferish && inbound ? e.otherAccountId : imp.accountId, toAccountId: transferish ? (inbound ? imp.accountId : e.otherAccountId) : null,
        interest: type === "loan_repayment" ? (e.interest ?? null) : null, status: "cleared", source: "statement", ref: r.ref ?? null,
        notes: r.time ? `Statement time ${r.time}` : null,
      });
      accepted.push(txnFromBody(body));
      if (d.remember && e.category && e.category !== r.suggestion.category && merchant.trim().length >= 3) learn.push({ match: merchant.trim().slice(0, 120), category: e.category, workspace: body.workspace });
    });
    if (accepted.length) await validate(id, accepted);
    const created = await repo.completeImport(id, imp.id, accepted, { ...imp.summary!, created: accepted.length, skipped: decisions.length - accepted.length });
    if (learn.length) { // corrections become explicit rules; the ledger is never changed silently
      const rules = await repo.getCollection(id, "rules");
      const next: RuleDTO[] = [...rules];
      for (const l of learn) {
        const ex = next.find((r) => r.match.toLowerCase() === l.match.toLowerCase());
        if (ex) Object.assign(ex, { category: l.category, workspace: l.workspace, enabled: true });
        else next.push({ id: `rule-${Date.now()}-${next.length}`, match: l.match, category: l.category, workspace: l.workspace, priority: next.length + 1, enabled: true });
      }
      await repo.replaceCollection(id, "rules", next);
    }
    await repo.audit(id, "statement.approve", "statement", imp.id, { created: created.length, skipped: decisions.length - accepted.length, rulesLearned: learn.length }, req.ip);
    res.json({ created: created.length, skipped: decisions.length - accepted.length, rulesLearned: learn.length });
  }));
}
