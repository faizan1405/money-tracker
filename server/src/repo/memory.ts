import { randomUUID } from "node:crypto";
import {
  ConflictError, DEFAULT_WORKSPACES, DuplicateRefError, type AccountRec, type CategoryRec, type CollectionKey, type Collections,
  type OwnerRec, type Repo, type SessionRec, type TxnFilter, type TxnInput, type TxnRec, type WorkspaceRec,
} from "./types.js";

/** In-memory repo for automated tests only. Mirrors PrismaRepo semantics (ownership, atomic batches, unique refs). */
export class MemoryRepo implements Repo {
  owners: OwnerRec[] = [];
  sessions: SessionRec[] = [];
  workspaces = new Map<string, WorkspaceRec[]>();
  accounts = new Map<string, AccountRec[]>();
  txns = new Map<string, TxnRec[]>();
  cats = new Map<string, CategoryRec[]>();
  cols = new Map<string, Collections>();
  logs: { ownerId: string; action: string }[] = [];
  down = false;

  async ping() { if (this.down) throw new Error("db down"); }
  async ownerCount() { return this.owners.length; }
  async findOwnerByEmail(email: string) { return this.owners.find((o) => o.email === email.toLowerCase()) ?? null; }
  async getOwner(id: string) { return this.owners.find((o) => o.id === id) ?? null; }
  async createOwner(o: Omit<OwnerRec, "id">) {
    const rec = { ...o, email: o.email.toLowerCase(), id: randomUUID() };
    this.owners.push(rec);
    this.workspaces.set(rec.id, DEFAULT_WORKSPACES.map((w) => ({ ...w })));
    return rec;
  }
  async createSession(s: Omit<SessionRec, "id">) { const r = { ...s, id: randomUUID() }; this.sessions.push(r); return r; }
  async findSession(h: string) { return this.sessions.find((s) => s.tokenHash === h) ?? null; }
  async deleteSession(h: string) { this.sessions = this.sessions.filter((s) => s.tokenHash !== h); }
  async listWorkspaces(ownerId: string) { return this.workspaces.get(ownerId) ?? []; }
  async listAccounts(ownerId: string) { return [...(this.accounts.get(ownerId) ?? [])]; }
  async replaceAccounts(ownerId: string, items: AccountRec[]) {
    const keep = new Set(items.map((a) => a.id));
    const used = (this.txns.get(ownerId) ?? []).some((t) => !keep.has(t.accountId) || (t.toAccountId && !keep.has(t.toAccountId)));
    if (used) throw new ConflictError("An account that still has transactions can't be removed");
    this.accounts.set(ownerId, items.map((a) => ({ ...a })));
    return items;
  }
  private all(ownerId: string) { return this.txns.get(ownerId) ?? []; }
  async listTxns(ownerId: string, f: TxnFilter = {}) {
    const q = f.q?.toLowerCase();
    let items = this.all(ownerId).filter((t) =>
      (!f.workspace || t.workspace === f.workspace) && (!f.from || t.date >= f.from) && (!f.to || t.date <= f.to) &&
      (!f.type || t.type === f.type) && (!f.category || t.category === f.category) &&
      (!f.accountId || t.accountId === f.accountId || t.toAccountId === f.accountId) &&
      (!q || [t.description, t.merchant, t.category, t.notes ?? "", t.client ?? ""].some((s) => s.toLowerCase().includes(q))));
    items = items.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const total = items.length;
    const skip = f.skip ?? 0;
    return { items: items.slice(skip, f.take ? skip + f.take : undefined), total };
  }
  async getTxn(ownerId: string, id: string) { return this.all(ownerId).find((t) => t.id === id) ?? null; }
  private checkRefs(existing: TxnRec[], items: TxnInput[], ignoreId?: string) {
    const seen = new Set(existing.filter((t) => t.ref && t.id !== ignoreId).map((t) => `${t.accountId}|${t.ref}`));
    for (const t of items) {
      if (!t.ref) continue;
      const k = `${t.accountId}|${t.ref}`;
      if (seen.has(k)) throw new DuplicateRefError(t.ref);
      seen.add(k);
    }
  }
  async createTxns(ownerId: string, items: TxnInput[]) {
    const cur = this.all(ownerId);
    this.checkRefs(cur, items); // throws before any insert → whole batch rolls back
    const created = items.map((t) => ({ ...t, id: randomUUID() }));
    this.txns.set(ownerId, [...cur, ...created]);
    return created;
  }
  async updateTxn(ownerId: string, id: string, t: TxnInput) {
    const cur = this.all(ownerId);
    this.checkRefs(cur, [t], id);
    const rec = { ...t, id };
    this.txns.set(ownerId, cur.map((x) => (x.id === id ? rec : x)));
    return rec;
  }
  async deleteTxns(ownerId: string, ids: string[]) {
    const cur = this.all(ownerId);
    const next = cur.filter((t) => !ids.includes(t.id));
    this.txns.set(ownerId, next);
    return cur.length - next.length;
  }
  async listCategories(ownerId: string) { return this.cats.get(ownerId) ?? []; }
  async createCategory(ownerId: string, c: Omit<CategoryRec, "id">) {
    const list = this.cats.get(ownerId) ?? [];
    if (list.some((x) => x.workspace === c.workspace && x.name === c.name)) throw new ConflictError("Category already exists");
    const r = { ...c, id: randomUUID() };
    this.cats.set(ownerId, [...list, r]);
    return r;
  }
  private colsOf(ownerId: string) {
    let c = this.cols.get(ownerId);
    if (!c) { c = { dues: [], budgets: [], goals: [], recurring: [], rules: [], customCategories: [] }; this.cols.set(ownerId, c); }
    return c;
  }
  async getCollection<K extends CollectionKey>(ownerId: string, key: K) { return this.colsOf(ownerId)[key]; }
  async replaceCollection<K extends CollectionKey>(ownerId: string, key: K, items: Collections[K]) { this.colsOf(ownerId)[key] = items; return items; }
  async audit(ownerId: string, action: string) { this.logs.push({ ownerId, action }); }
}
