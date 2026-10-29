import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { COOKIE, cookieOptions, dummyHash, newToken, requireAuth, sha256, verifyPassword } from "./auth.js";
import type { AppConfig } from "./config.js";
import { accountBalance, byCategory, byMonth, totals } from "./domain/ledger.js";
import { AccountBody, CollectionSchemas, TxnBody, accountFromBody, accountToDto, txnFromBody, txnToBody, txnToDto } from "./dto.js";
import { HttpError, ah, errorHandler, notImplemented } from "./http.js";
import { toRupees } from "./money.js";
import type { AccountRec, CollectionKey, Repo, TxnInput } from "./repo/types.js";

export interface AppDeps { repo: Repo; config: AppConfig; now?: () => number; loginLimit?: number }

const owner = (req: Request) => {
  if (!req.ownerId) throw new HttpError(401, "Please sign in", "unauthenticated");
  return req.ownerId;
};

export function createApp({ repo, config, now = Date.now, loginLimit = 10 }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Hostinger runs Node behind a proxy
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  const auth = requireAuth(repo, config, now);

  // ---------- Health (public, no data) ----------
  app.get("/api/health", ah(async (_req, res) => {
    try {
      await repo.ping();
      res.json({ ok: true, version: config.version });
    } catch {
      res.status(503).json({ ok: false, version: config.version, message: "Database unavailable" });
    }
  }));

  // ---------- Auth ----------
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: loginLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String((req.body as { email?: unknown })?.email ?? "").toLowerCase()}`,
    handler: (_req, res) => res.status(429).json({ message: "Too many sign-in attempts. Try again in 15 minutes.", code: "rate_limited" }),
  });
  const LoginBody = z.object({ email: z.string().email().max(191), password: z.string().min(1).max(200) });

  app.post("/api/auth/login", loginLimiter, ah(async (req, res) => {
    const { email, password } = LoginBody.parse(req.body);
    const o = await repo.findOwnerByEmail(email);
    const ok = o ? await verifyPassword(password, o.passwordHash) : (await verifyPassword(password, await dummyHash()), false);
    if (!o || !ok) throw new HttpError(401, "Email or password is incorrect", "bad_credentials");
    const token = newToken();
    const expiresAt = new Date(now() + config.sessionTtlMs);
    await repo.createSession({ ownerId: o.id, tokenHash: sha256(token), expiresAt }, { ip: req.ip, userAgent: req.get("user-agent") });
    await repo.audit(o.id, "auth.login", "session", null, undefined, req.ip);
    res.cookie(COOKIE, token, cookieOptions(config, config.sessionTtlMs));
    res.json({ token, expiresAt: expiresAt.toISOString(), user: { id: o.id, email: o.email, name: o.name } });
  }));

  app.post("/api/auth/logout", auth, ah(async (req, res) => {
    await repo.deleteSession(req.tokenHash!);
    await repo.audit(owner(req), "auth.logout", "session");
    res.clearCookie(COOKIE, cookieOptions(config));
    res.status(204).end();
  }));

  app.get("/api/auth/me", auth, ah(async (req, res) => {
    const o = await repo.getOwner(owner(req));
    if (!o) throw new HttpError(401, "Please sign in", "unauthenticated");
    res.json({ id: o.id, email: o.email, name: o.name });
  }));

  // Everything below requires a session.
  app.use("/api", auth);

  const workspacesDto = async (id: string) => (await repo.listWorkspaces(id)).map((w) => ({ id: w.key, name: w.name, short: w.short, kind: w.kind }));

  app.get("/api/workspaces", ah(async (req, res) => { res.json(await workspacesDto(owner(req))); }));

  // ---------- Accounts ----------
  app.get("/api/accounts", ah(async (req, res) => { res.json((await repo.listAccounts(owner(req))).map(accountToDto)); }));
  app.get("/api/accounts/balances", ah(async (req, res) => {
    const id = owner(req);
    const [accs, { items }] = await Promise.all([repo.listAccounts(id), repo.listTxns(id)]);
    res.json(accs.map((a) => ({ accountId: a.id, balance: toRupees(accountBalance(a.openingBalancePaise, a.id, items)) })));
  }));

  // ---------- Categories ----------
  app.get("/api/categories", ah(async (req, res) => { res.json(await repo.listCategories(owner(req))); }));
  app.post("/api/categories", ah(async (req, res) => {
    const b = z.object({ name: z.string().trim().min(1).max(80), workspace: z.string().min(1).max(40), kind: z.enum(["income", "expense"]) }).parse(req.body);
    await assertWorkspace(owner(req), b.workspace);
    res.status(201).json(await repo.createCategory(owner(req), { ...b, custom: true }));
  }));

  // ---------- Transactions ----------
  async function assertWorkspace(ownerId: string, key: string) {
    if (!(await repo.listWorkspaces(ownerId)).some((w) => w.key === key)) throw new HttpError(422, `Unknown workspace: ${key}`, "validation");
  }

  /** Ownership + accounting validation shared by create and update. */
  async function validate(ownerId: string, items: TxnInput[]) {
    const [accs, wss] = await Promise.all([repo.listAccounts(ownerId), repo.listWorkspaces(ownerId)]);
    const byId = new Map<string, AccountRec>(accs.map((a) => [a.id, a]));
    const wsKeys = new Set(wss.map((w) => w.key));
    items.forEach((t, i) => {
      const f = (field: string, message: string) => { throw new HttpError(422, message, "validation", [{ field: `items.${i}.${field}`, message }]); };
      if (!wsKeys.has(t.workspace)) f("workspace", "Unknown workspace");
      if (!byId.has(t.accountId)) f("accountId", "Account not found"); // also blocks other owners' accounts
      if (t.type === "transfer" || t.type === "cc_payment") {
        if (!t.toAccountId) f("toAccountId", "Choose the account the money goes to");
        else if (!byId.has(t.toAccountId)) f("toAccountId", "Account not found");
        else if (t.toAccountId === t.accountId) f("toAccountId", "From and to accounts must be different");
        else if (t.type === "cc_payment" && byId.get(t.toAccountId)!.kind !== "credit_card") f("toAccountId", "A card payment must go to a credit card account");
      }
      if (t.type === "loan_repayment" && (t.interestPaise ?? 0) > t.amountPaise) f("interest", "Interest can't exceed the payment");
    });
  }

  const ListQuery = z.object({
    workspace: z.string().optional(), from: z.string().optional(), to: z.string().optional(), type: z.string().optional(),
    accountId: z.string().optional(), category: z.string().optional(), q: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100),
  });

  app.get("/api/transactions", ah(async (req, res) => {
    const q = ListQuery.parse(req.query);
    const { items, total } = await repo.listTxns(owner(req), { ...q, skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    res.json({ items: items.map(txnToDto), total, page: q.page, pageSize: q.pageSize });
  }));

  app.post("/api/transactions", ah(async (req, res) => {
    const { items } = z.object({ items: z.array(TxnBody).min(1).max(1000) }).parse(req.body);
    const id = owner(req);
    const recs = items.map(txnFromBody);
    await validate(id, recs);
    const created = await repo.createTxns(id, recs); // atomic; duplicate ref → 409, nothing saved
    await repo.audit(id, "txn.create", "transaction", null, { count: created.length }, req.ip);
    res.status(201).json(created.map(txnToDto));
  }));

  app.patch("/api/transactions/:id", ah(async (req, res) => {
    const id = owner(req);
    const cur = await repo.getTxn(id, req.params.id!);
    if (!cur) throw new HttpError(404, "Transaction not found", "not_found");
    const patch = TxnBody.partial().parse(req.body);
    const merged = TxnBody.parse({ ...txnToBody(cur), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    const rec = txnFromBody(merged);
    await validate(id, [rec]);
    const saved = await repo.updateTxn(id, cur.id, rec);
    await repo.audit(id, "txn.update", "transaction", cur.id, undefined, req.ip);
    res.json(txnToDto(saved));
  }));

  app.post("/api/transactions/delete", ah(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) }).parse(req.body);
    const id = owner(req);
    const n = await repo.deleteTxns(id, ids);
    await repo.audit(id, "txn.delete", "transaction", null, { count: n }, req.ip);
    res.status(204).end();
  }));

  // ---------- Collections (full replace, atomic) ----------
  app.get("/api/dues", ah(async (req, res) => { res.json(await repo.getCollection(owner(req), "dues")); }));
  app.get("/api/budgets", ah(async (req, res) => { res.json(await repo.getCollection(owner(req), "budgets")); }));

  app.put("/api/collections/:key", ah(async (req, res) => {
    const id = owner(req);
    const key = req.params.key!;
    const body = z.object({ items: z.unknown() }).parse(req.body);
    if (key === "accounts") {
      const items = z.array(AccountBody).parse(body.items).map(accountFromBody);
      for (const a of items) await assertWorkspace(id, a.workspace);
      const saved = await repo.replaceAccounts(id, items);
      await repo.audit(id, "collection.replace", "accounts", null, { count: saved.length }, req.ip);
      return void res.json(saved.map(accountToDto));
    }
    if (!(key in CollectionSchemas)) throw new HttpError(404, "Unknown collection", "not_found");
    const k = key as CollectionKey;
    const items = CollectionSchemas[k].parse(body.items);
    const saved = await repo.replaceCollection(id, k, items as never);
    await repo.audit(id, "collection.replace", k, null, { count: Array.isArray(saved) ? saved.length : 0 }, req.ip);
    res.json(saved);
  }));

  // ---------- Bootstrap ----------
  app.get("/api/bootstrap", ah(async (req, res) => {
    const id = owner(req);
    const [o, workspaces, accounts, txns, dues, budgets, goals, recurring, rules, customCategories] = await Promise.all([
      repo.getOwner(id), workspacesDto(id), repo.listAccounts(id), repo.listTxns(id),
      repo.getCollection(id, "dues"), repo.getCollection(id, "budgets"), repo.getCollection(id, "goals"),
      repo.getCollection(id, "recurring"), repo.getCollection(id, "rules"), repo.getCollection(id, "customCategories"),
    ]);
    if (!o) throw new HttpError(401, "Please sign in", "unauthenticated");
    res.json({
      user: { id: o.id, email: o.email, name: o.name }, workspaces, accounts: accounts.map(accountToDto),
      transactions: txns.items.map(txnToDto), dues, budgets, goals, recurring, rules, customCategories,
    });
  }));

  // ---------- Dashboard / analytics ----------
  app.get("/api/analytics/summary", ah(async (req, res) => {
    const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), workspace: z.string().optional() }).parse(req.query);
    const ws = q.workspace && q.workspace !== "all" ? q.workspace : undefined;
    const { items } = await repo.listTxns(owner(req), { from: q.from, to: q.to, workspace: ws });
    const t = totals(items);
    res.json({
      from: q.from, to: q.to, income: toRupees(t.income), expense: toRupees(t.expense), net: toRupees(t.net),
      byCategory: byCategory(items).map((r) => ({ category: r.category, amount: toRupees(r.amount) })),
      byMonth: byMonth(items).map((r) => ({ month: r.month, income: toRupees(r.income), expense: toRupees(r.expense) })),
    });
  }));

  // ---------- Not yet implemented: explicit errors, never fake success ----------
  app.all(["/api/statements", "/api/statements/*"], () => { throw notImplemented("Statement import"); });
  app.post("/api/ai/chat", () => { throw notImplemented("The AI assistant"); });
  app.all(["/api/invoices*", "/api/clients*", "/api/projects*", "/api/reports*"], () => { throw notImplemented("This module"); });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));
  app.use(errorHandler);
  return app;
}
