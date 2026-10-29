import { randomUUID } from "node:crypto";
import {
  ConflictError, DEFAULT_WORKSPACES, DuplicateRefError, type AccountRec, type CategoryRec, type CollectionKey, type Collections,
  type OwnerRec, type Repo, type SessionRec, type TxnFilter, type TxnInput, type TxnRec, type WorkspaceRec,
  type AiReserve, type AiSettle, type AiUsageSummary, type ChatMessageRec, type ConversationRec,
} from "./types.js";
import type { ImportRec } from "../statements/types.js";

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
  imports = new Map<string, ImportRec[]>();
  failNextComplete = false; // test hook: simulate a DB failure mid-approval
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
  private imps(ownerId: string) { let l = this.imports.get(ownerId); if (!l) { l = []; this.imports.set(ownerId, l); } return l; }
  async createImport(ownerId: string, i: Omit<ImportRec, "id" | "createdAt">) {
    const r: ImportRec = structuredClone({ ...i, id: randomUUID(), createdAt: new Date().toISOString() });
    this.imps(ownerId).push(r);
    return structuredClone(r);
  }
  async getImport(ownerId: string, id: string) { const r = this.imps(ownerId).find((x) => x.id === id); return r ? structuredClone(r) : null; }
  async listImports(ownerId: string) { return [...this.imps(ownerId)].reverse().map((r) => ({ ...structuredClone(r), rows: null })); }
  async findImportsByHash(ownerId: string, accountId: string, fileHash: string) { return this.imps(ownerId).filter((r) => r.accountId === accountId && r.fileHash === fileHash).map((r) => structuredClone(r)); }
  async updateImport(ownerId: string, id: string, patch: Partial<Pick<ImportRec, "status" | "error" | "summary" | "rows">>) {
    const r = this.imps(ownerId).find((x) => x.id === id);
    if (!r) throw new ConflictError("Import not found");
    Object.assign(r, structuredClone(patch));
    return structuredClone(r);
  }
  async completeImport(ownerId: string, id: string, txns: TxnInput[], summary: ImportRec["summary"]) {
    const r = this.imps(ownerId).find((x) => x.id === id);
    if (!r || r.status !== "needs_review") throw new ConflictError("This statement has already been saved");
    const before = this.all(ownerId);
    const created = await this.createTxns(ownerId, txns);
    if (this.failNextComplete) { this.failNextComplete = false; this.txns.set(ownerId, before); throw new Error("simulated db failure"); }
    Object.assign(r, { status: "completed", rows: null, summary: structuredClone(summary) });
    return created;
  }

  // ---------- AI usage ----------
  private usage: (AiSettle & { id: string; ownerId: string; day: string; month: string; reservedMicroUsd: number; status: "reserved" | "settled" | "failed"; feature: string })[] = [];
  private spendOf(ownerId: string, pick: (u: { day: string; month: string }) => boolean) {
    return this.usage.filter((u) => u.ownerId === ownerId && pick(u)).reduce((s, u) => s + (u.status === "reserved" ? u.reservedMicroUsd : u.costMicroUsd), 0);
  }
  async reserveAi(ownerId: string, r: AiReserve) {
    // Single-threaded JS: check + insert happen with no await in between, so this is atomic.
    if (this.spendOf(ownerId, (u) => u.day === r.day) + r.reserveMicroUsd > r.dailyLimitMicroUsd) return { ok: false as const, limit: "daily" as const };
    if (this.spendOf(ownerId, (u) => u.month === r.month) + r.reserveMicroUsd > r.monthlyLimitMicroUsd) return { ok: false as const, limit: "monthly" as const };
    const id = randomUUID();
    this.usage.push({ id, ownerId, feature: r.feature, model: r.model, day: r.day, month: r.month, reservedMicroUsd: r.reserveMicroUsd, status: "reserved", costMicroUsd: 0, promptTokens: 0, completionTokens: 0, ms: 0 });
    return { ok: true as const, id };
  }
  async settleAi(ownerId: string, id: string, s: AiSettle) {
    const u = this.usage.find((x) => x.id === id && x.ownerId === ownerId);
    if (u) Object.assign(u, s);
  }
  async aiUsage(ownerId: string, day: string, month: string): Promise<AiUsageSummary> {
    const m = this.usage.filter((u) => u.ownerId === ownerId && u.month === month);
    return {
      dayMicroUsd: this.spendOf(ownerId, (u) => u.day === day), monthMicroUsd: this.spendOf(ownerId, (u) => u.month === month),
      requestsToday: m.filter((u) => u.day === day).length, requestsMonth: m.length,
      promptTokensMonth: m.reduce((s, u) => s + u.promptTokens, 0), completionTokensMonth: m.reduce((s, u) => s + u.completionTokens, 0),
    };
  }

  // ---------- Conversations ----------
  private convs: (ConversationRec & { ownerId: string; messages: ChatMessageRec[] })[] = [];
  async listConversations(ownerId: string) {
    return this.convs.filter((c) => c.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
  }
  async getConversation(ownerId: string, id: string) {
    const c = this.convs.find((x) => x.id === id && x.ownerId === ownerId);
    if (!c) return null;
    const { ownerId: _o, ...rest } = structuredClone(c);
    return rest;
  }
  async createConversation(ownerId: string, title: string) {
    const now = new Date().toISOString();
    const c = { id: randomUUID(), ownerId, title, createdAt: now, updatedAt: now, messages: [] as ChatMessageRec[] };
    this.convs.push(c);
    return { id: c.id, title, createdAt: now, updatedAt: now };
  }
  async addMessages(ownerId: string, conversationId: string, msgs: Omit<ChatMessageRec, "id" | "createdAt">[]) {
    const c = this.convs.find((x) => x.id === conversationId && x.ownerId === ownerId);
    if (!c) throw new ConflictError("Conversation not found");
    const now = new Date().toISOString();
    const out = msgs.map((m) => ({ ...structuredClone(m), id: randomUUID(), createdAt: now }));
    c.messages.push(...out);
    c.updatedAt = now;
    return structuredClone(out);
  }
  async deleteConversation(ownerId: string, id: string) {
    const n = this.convs.length;
    this.convs = this.convs.filter((c) => !(c.id === id && c.ownerId === ownerId));
    return this.convs.length < n;
  }
  async purgeConversations(ownerId: string, before: Date) {
    const n = this.convs.length;
    this.convs = this.convs.filter((c) => !(c.ownerId === ownerId && c.updatedAt < before.toISOString()));
    return n - this.convs.length;
  }
}
