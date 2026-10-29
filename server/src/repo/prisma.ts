import { Prisma, PrismaClient } from "@prisma/client";
import { bigToPaise, toPaise, toRupees } from "../money.js";
import type { TxnType } from "../domain/ledger.js";
import {
  ConflictError, DEFAULT_WORKSPACES, DuplicateRefError, type AccountRec, type CategoryRec, type CollectionKey, type Collections,
  type OwnerRec, type Repo, type SessionRec, type TxnFilter, type TxnInput, type TxnRec, type WorkspaceRec,
} from "./types.js";
import type { ImportRec, ImportSummary, ReviewRow } from "../statements/types.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ds = (x: Date) => x.toISOString().slice(0, 10);
const big = (p: number) => BigInt(p);
const optBig = (p: number | null | undefined) => (p == null ? null : BigInt(p));
const optNum = (v: bigint | null) => (v == null ? null : bigToPaise(v));
const und = <T>(v: T | null): T | undefined => (v == null ? undefined : v);

type DbTxn = Prisma.TransactionGetPayload<object>;
function txnFromDb(t: DbTxn): TxnRec {
  return {
    id: t.id, date: ds(t.date), type: t.type as TxnType, amountPaise: bigToPaise(t.amountPaise),
    adjustmentSign: t.adjustmentSign === -1 ? -1 : t.adjustmentSign === 1 ? 1 : null,
    interestPaise: optNum(t.interestPaise), description: t.description, merchant: t.merchant, category: t.category,
    subcategory: t.subcategory, workspace: t.workspace, accountId: t.accountId, toAccountId: t.toAccountId,
    client: t.client, project: t.project, notes: t.notes, status: t.status as TxnRec["status"], recurring: t.recurring,
    source: t.source as TxnRec["source"], ref: t.ref,
  };
}
function txnToDb(ownerId: string, t: TxnInput) {
  return {
    ownerId, date: d(t.date), type: t.type, amountPaise: big(t.amountPaise), adjustmentSign: t.adjustmentSign ?? null,
    interestPaise: optBig(t.interestPaise), description: t.description, merchant: t.merchant, category: t.category,
    subcategory: t.subcategory ?? null, workspace: t.workspace, accountId: t.accountId, toAccountId: t.toAccountId ?? null,
    client: t.client ?? null, project: t.project ?? null, notes: t.notes ?? null, status: t.status, recurring: t.recurring,
    source: t.source, ref: t.ref ?? null,
  };
}
type DbImport = Prisma.StatementImportGetPayload<object>;
function importFromDb(i: DbImport, withRows = true): ImportRec {
  return {
    id: i.id, accountId: i.accountId, workspace: i.workspace, fileName: i.fileName, fileHash: i.fileHash, status: i.status as ImportRec["status"],
    error: i.error, createdAt: i.createdAt.toISOString(), summary: (i.summary as unknown as ImportSummary | null) ?? null,
    rows: withRows ? ((i.rows as unknown as ReviewRow[] | null) ?? null) : null,
  };
}
const json = (v: unknown) => (v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));
function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export class PrismaRepo implements Repo {
  constructor(private db = new PrismaClient()) {}

  async ping() { await this.db.$queryRaw`SELECT 1`; }
  ownerCount() { return this.db.owner.count(); }
  findOwnerByEmail(email: string) { return this.db.owner.findUnique({ where: { email: email.toLowerCase() } }); }
  getOwner(id: string) { return this.db.owner.findUnique({ where: { id } }); }
  async createOwner(o: Omit<OwnerRec, "id">) {
    return this.db.$transaction(async (tx) => {
      if ((await tx.owner.count()) > 0) throw new ConflictError("Owner already exists");
      const owner = await tx.owner.create({ data: { ...o, email: o.email.toLowerCase() } });
      await tx.workspace.createMany({ data: DEFAULT_WORKSPACES.map((w) => ({ ...w, ownerId: owner.id })) });
      return owner;
    });
  }

  createSession(s: Omit<SessionRec, "id">, meta?: { ip?: string | undefined; userAgent?: string | undefined }) {
    return this.db.session.create({ data: { ...s, ip: meta?.ip ?? null, userAgent: meta?.userAgent?.slice(0, 255) ?? null } });
  }
  findSession(tokenHash: string) { return this.db.session.findUnique({ where: { tokenHash } }); }
  async deleteSession(tokenHash: string) { await this.db.session.deleteMany({ where: { tokenHash } }); }

  async listWorkspaces(ownerId: string): Promise<WorkspaceRec[]> {
    const rows = await this.db.workspace.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
    return rows.map((w) => ({ key: w.key, name: w.name, short: w.short, kind: w.kind as WorkspaceRec["kind"] }));
  }

  async listAccounts(ownerId: string): Promise<AccountRec[]> {
    const rows = await this.db.account.findMany({ where: { ownerId, archived: false }, orderBy: { createdAt: "asc" } });
    return rows.map((a) => ({
      id: a.id, workspace: a.workspace, name: a.name, institution: a.institution, kind: a.kind as AccountRec["kind"],
      openingBalancePaise: bigToPaise(a.openingBalancePaise), creditLimitPaise: optNum(a.creditLimitPaise), last4: a.last4,
      reconciled: a.reconciled as AccountRec["reconciled"],
    }));
  }
  async replaceAccounts(ownerId: string, items: AccountRec[]) {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.account.findMany({ where: { ownerId }, select: { id: true } });
      const keep = new Set(items.map((a) => a.id));
      const removed = existing.map((a) => a.id).filter((id) => !keep.has(id));
      if (removed.length) {
        const used = await tx.transaction.count({ where: { ownerId, OR: [{ accountId: { in: removed } }, { toAccountId: { in: removed } }] } });
        if (used) throw new ConflictError("An account that still has transactions can't be removed");
        await tx.account.deleteMany({ where: { ownerId, id: { in: removed } } });
      }
      const ownIds = new Set(existing.map((a) => a.id));
      for (const a of items) {
        const data = {
          workspace: a.workspace, name: a.name, institution: a.institution, kind: a.kind, openingBalancePaise: big(a.openingBalancePaise),
          creditLimitPaise: optBig(a.creditLimitPaise), last4: a.last4 ?? null, reconciled: a.reconciled,
        };
        if (ownIds.has(a.id)) await tx.account.update({ where: { id: a.id }, data });
        else await tx.account.create({ data: { ...data, ownerId } }); // never trust client ids for new rows
      }
    });
    return this.listAccounts(ownerId);
  }

  private where(ownerId: string, f: TxnFilter): Prisma.TransactionWhereInput {
    const w: Prisma.TransactionWhereInput = { ownerId };
    if (f.workspace) w.workspace = f.workspace;
    if (f.type) w.type = f.type;
    if (f.category) w.category = f.category;
    if (f.from || f.to) w.date = { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) };
    const and: Prisma.TransactionWhereInput[] = [];
    if (f.accountId) and.push({ OR: [{ accountId: f.accountId }, { toAccountId: f.accountId }] });
    if (f.q) and.push({ OR: [{ description: { contains: f.q } }, { merchant: { contains: f.q } }, { category: { contains: f.q } }, { notes: { contains: f.q } }, { client: { contains: f.q } }] });
    if (and.length) w.AND = and;
    return w;
  }
  async listTxns(ownerId: string, f: TxnFilter = {}) {
    const where = this.where(ownerId, f);
    const [rows, total] = await this.db.$transaction([
      this.db.transaction.findMany({ where, orderBy: [{ date: "desc" }, { id: "desc" }], skip: f.skip ?? 0, ...(f.take ? { take: f.take } : {}) }),
      this.db.transaction.count({ where }),
    ]);
    return { items: rows.map(txnFromDb), total };
  }
  async getTxn(ownerId: string, id: string) {
    const t = await this.db.transaction.findFirst({ where: { id, ownerId } });
    return t ? txnFromDb(t) : null;
  }
  async createTxns(ownerId: string, items: TxnInput[]) {
    try {
      return await this.db.$transaction(async (tx) => {
        const out: TxnRec[] = [];
        for (const t of items) out.push(txnFromDb(await tx.transaction.create({ data: txnToDb(ownerId, t) })));
        return out;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateRefError(items.find((t) => t.ref)?.ref ?? "");
      throw e;
    }
  }
  async updateTxn(ownerId: string, id: string, t: TxnInput) {
    try {
      const r = await this.db.transaction.update({ where: { id, ownerId }, data: txnToDb(ownerId, t) });
      return txnFromDb(r);
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateRefError(t.ref ?? "");
      throw e;
    }
  }
  async deleteTxns(ownerId: string, ids: string[]) {
    const r = await this.db.transaction.deleteMany({ where: { ownerId, id: { in: ids } } });
    return r.count;
  }

  async listCategories(ownerId: string): Promise<CategoryRec[]> {
    const rows = await this.db.category.findMany({ where: { ownerId }, orderBy: { name: "asc" } });
    return rows.map((c) => ({ id: c.id, name: c.name, workspace: c.workspace, kind: c.kind as CategoryRec["kind"], custom: c.custom }));
  }
  async createCategory(ownerId: string, c: Omit<CategoryRec, "id">) {
    try {
      const r = await this.db.category.create({ data: { ...c, ownerId } });
      return { id: r.id, name: r.name, workspace: r.workspace, kind: r.kind as CategoryRec["kind"], custom: r.custom };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError("Category already exists");
      throw e;
    }
  }

  async getCollection<K extends CollectionKey>(ownerId: string, key: K): Promise<Collections[K]> {
    const db = this.db;
    switch (key) {
      case "dues": {
        const rows = await db.loan.findMany({ where: { ownerId }, include: { repayments: { orderBy: { date: "asc" } } } });
        return rows.map((l) => ({
          id: l.id, direction: l.direction as "i_owe", kind: l.kind as "loan", party: l.party, principal: toRupees(l.principalPaise),
          outstanding: toRupees(l.outstandingPaise), dueDate: ds(l.dueDate), interestRate: l.interestRateBp == null ? undefined : l.interestRateBp / 100,
          emi: l.emiPaise == null ? undefined : toRupees(l.emiPaise), workspace: l.workspace, notes: und(l.notes),
          payments: l.repayments.map((p) => ({ date: ds(p.date), amount: toRupees(p.amountPaise), interest: toRupees(p.interestPaise) })),
        })) as Collections[K];
      }
      case "budgets":
        return (await db.budget.findMany({ where: { ownerId } })).map((b) => ({ id: b.id, category: b.category, workspace: b.workspace, limit: toRupees(b.limitPaise) })) as Collections[K];
      case "goals":
        return (await db.goal.findMany({ where: { ownerId } })).map((g) => ({ id: g.id, name: g.name, target: toRupees(g.targetPaise), saved: toRupees(g.savedPaise), deadline: ds(g.deadline) })) as Collections[K];
      case "recurring":
        return (await db.recurring.findMany({ where: { ownerId } })).map((r) => ({ id: r.id, name: r.name, amount: toRupees(r.amountPaise), category: r.category, workspace: r.workspace, nextDate: ds(r.nextDate), cadence: r.cadence as "monthly" })) as Collections[K];
      case "rules":
        return (await db.rule.findMany({ where: { ownerId }, orderBy: { priority: "asc" } })).map((r) => ({ id: r.id, match: r.match, category: r.category, workspace: r.workspace, priority: r.priority, enabled: r.enabled })) as Collections[K];
      case "customCategories":
        return (await db.category.findMany({ where: { ownerId, custom: true } })).map((c) => c.name) as Collections[K];
    }
    throw new Error("unknown collection");
  }

  /** Full replace inside one DB transaction: either the whole new list is saved or nothing changes. */
  async replaceCollection<K extends CollectionKey>(ownerId: string, key: K, items: Collections[K]): Promise<Collections[K]> {
    await this.db.$transaction(async (tx) => {
      switch (key) {
        case "dues": {
          await tx.loan.deleteMany({ where: { ownerId } });
          for (const l of items as Collections["dues"]) {
            await tx.loan.create({
              data: {
                ownerId, workspace: l.workspace, direction: l.direction, kind: l.kind, party: l.party, principalPaise: big(toPaise(l.principal)),
                outstandingPaise: big(toPaise(l.outstanding)), dueDate: d(l.dueDate), interestRateBp: l.interestRate == null ? null : Math.round(l.interestRate * 100),
                emiPaise: l.emi == null ? null : big(toPaise(l.emi)), notes: l.notes ?? null,
                repayments: { create: l.payments.map((p) => ({ date: d(p.date), amountPaise: big(toPaise(p.amount)), interestPaise: big(toPaise(p.interest ?? 0)) })) },
              },
            });
          }
          break;
        }
        case "budgets":
          await tx.budget.deleteMany({ where: { ownerId } });
          await tx.budget.createMany({ data: (items as Collections["budgets"]).map((b) => ({ ownerId, category: b.category, workspace: b.workspace, limitPaise: big(toPaise(b.limit)) })) });
          break;
        case "goals":
          await tx.goal.deleteMany({ where: { ownerId } });
          await tx.goal.createMany({ data: (items as Collections["goals"]).map((g) => ({ ownerId, name: g.name, targetPaise: big(toPaise(g.target)), savedPaise: big(toPaise(g.saved)), deadline: d(g.deadline) })) });
          break;
        case "recurring":
          await tx.recurring.deleteMany({ where: { ownerId } });
          await tx.recurring.createMany({ data: (items as Collections["recurring"]).map((r) => ({ ownerId, name: r.name, amountPaise: big(toPaise(r.amount)), category: r.category, workspace: r.workspace, nextDate: d(r.nextDate), cadence: r.cadence })) });
          break;
        case "rules":
          await tx.rule.deleteMany({ where: { ownerId } });
          await tx.rule.createMany({ data: (items as Collections["rules"]).map((r) => ({ ownerId, match: r.match, category: r.category, workspace: r.workspace, priority: r.priority, enabled: r.enabled })) });
          break;
        case "customCategories": {
          const names = [...new Set(items as string[])];
          await tx.category.deleteMany({ where: { ownerId, custom: true, name: { notIn: names } } });
          const have = new Set((await tx.category.findMany({ where: { ownerId, custom: true } })).map((c) => c.name));
          const add = names.filter((n) => !have.has(n));
          if (add.length) await tx.category.createMany({ data: add.map((name) => ({ ownerId, name, workspace: "personal", kind: "expense", custom: true })) });
          break;
        }
      }
    });
    return this.getCollection(ownerId, key);
  }

  async audit(ownerId: string, action: string, entity: string, entityId?: string | null, detail?: unknown, ip?: string) {
    await this.db.auditLog.create({
      data: { ownerId, action, entity, entityId: entityId ?? null, detail: detail === undefined ? Prisma.JsonNull : (detail as Prisma.InputJsonValue), ip: ip ?? null },
    });
  }

  async createImport(ownerId: string, i: Omit<ImportRec, "id" | "createdAt">) {
    const r = await this.db.statementImport.create({ data: { ownerId, accountId: i.accountId, workspace: i.workspace, fileName: i.fileName, fileHash: i.fileHash, status: i.status, error: i.error ?? null, summary: json(i.summary), rows: json(i.rows) } });
    return importFromDb(r);
  }
  async getImport(ownerId: string, id: string) {
    const r = await this.db.statementImport.findFirst({ where: { id, ownerId } });
    return r ? importFromDb(r) : null;
  }
  async listImports(ownerId: string) {
    const rs = await this.db.statementImport.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ownerId: true, accountId: true, workspace: true, fileName: true, fileHash: true, status: true, error: true, summary: true, createdAt: true, updatedAt: true } });
    return rs.map((r) => importFromDb({ ...r, rows: null }, false));
  }
  async findImportsByHash(ownerId: string, accountId: string, fileHash: string) {
    const rs = await this.db.statementImport.findMany({ where: { ownerId, accountId, fileHash } });
    return rs.map((r) => importFromDb(r, false));
  }
  async updateImport(ownerId: string, id: string, patch: Partial<Pick<ImportRec, "status" | "error" | "summary" | "rows">>) {
    const n = await this.db.statementImport.updateMany({
      where: { id, ownerId },
      data: { ...(patch.status ? { status: patch.status } : {}), ...("error" in patch ? { error: patch.error ?? null } : {}), ...("summary" in patch ? { summary: json(patch.summary) } : {}), ...("rows" in patch ? { rows: json(patch.rows) } : {}) },
    });
    if (!n.count) throw new ConflictError("Import not found");
    return (await this.getImport(ownerId, id))!;
  }
  async completeImport(ownerId: string, id: string, txns: TxnInput[], summary: ImportRec["summary"]) {
    try {
      return await this.db.$transaction(async (tx) => {
        // Conditional status flip first: a second concurrent approval updates 0 rows and aborts.
        const n = await tx.statementImport.updateMany({ where: { id, ownerId, status: "needs_review" }, data: { status: "completed", rows: Prisma.JsonNull, summary: json(summary) } });
        if (!n.count) throw new ConflictError("This statement has already been saved");
        const out: TxnRec[] = [];
        for (const t of txns) out.push(txnFromDb(await tx.transaction.create({ data: { ...txnToDb(ownerId, t), importId: id } })));
        return out;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateRefError(txns.find((t) => t.ref)?.ref ?? "");
      throw e;
    }
  }
}
