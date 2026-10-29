import type { LedgerTxn } from "../domain/ledger.js";
import type { ImportRec } from "../statements/types.js";

/** Storage boundary. PrismaRepo (MySQL) is used in production; MemoryRepo only in automated tests. */

export interface OwnerRec { id: string; email: string; name: string; passwordHash: string }
export interface SessionRec { id: string; ownerId: string; tokenHash: string; expiresAt: Date }
export interface WorkspaceRec { key: string; name: string; short: string; kind: "personal" | "business" }

export interface AccountRec {
  id: string;
  workspace: string;
  name: string;
  institution: string;
  kind: "bank" | "cash" | "upi" | "credit_card" | "wallet";
  openingBalancePaise: number;
  creditLimitPaise?: number | null;
  last4?: string | null;
  reconciled: "reconciled" | "pending" | "never";
}

export interface TxnRec extends LedgerTxn {
  description: string;
  subcategory?: string | null;
  client?: string | null;
  project?: string | null;
  notes?: string | null;
  status: "cleared" | "pending";
  recurring: boolean;
  source: "manual" | "statement" | "demo";
}
export type TxnInput = Omit<TxnRec, "id">;

export interface TxnFilter {
  workspace?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  type?: string | undefined;
  accountId?: string | undefined;
  category?: string | undefined;
  q?: string | undefined;
  skip?: number | undefined;
  take?: number | undefined;
}

export interface CategoryRec { id: string; name: string; workspace: string; kind: "income" | "expense"; custom: boolean }

// Collections use the frontend DTO shape (rupees); the repo converts to paise for storage.
export interface DueDTO {
  id: string; direction: "i_owe" | "owed_to_me"; kind: "loan" | "personal" | "client" | "emi"; party: string;
  principal: number; outstanding: number; dueDate: string; interestRate?: number | undefined; emi?: number | undefined;
  workspace: string; notes?: string | undefined; payments: { date: string; amount: number; interest?: number | undefined }[];
}
export interface BudgetDTO { id: string; category: string; workspace: string; limit: number }
export interface GoalDTO { id: string; name: string; target: number; saved: number; deadline: string }
export interface RecurringDTO { id: string; name: string; amount: number; category: string; workspace: string; nextDate: string; cadence: "monthly" | "yearly" | "quarterly" }
export interface RuleDTO { id: string; match: string; category: string; workspace: string; priority: number; enabled: boolean }

export interface Collections {
  dues: DueDTO[];
  budgets: BudgetDTO[];
  goals: GoalDTO[];
  recurring: RecurringDTO[];
  rules: RuleDTO[];
  customCategories: string[];
}
export type CollectionKey = keyof Collections;

export class DuplicateRefError extends Error {
  constructor(public ref: string) {
    super(`A transaction with reference ${ref} already exists on this account`);
  }
}
export class ConflictError extends Error {}

export interface Repo {
  ping(): Promise<void>;
  ownerCount(): Promise<number>;
  findOwnerByEmail(email: string): Promise<OwnerRec | null>;
  getOwner(id: string): Promise<OwnerRec | null>;
  /** Creates the owner plus default Personal + Scale Flow workspaces in one transaction. */
  createOwner(o: Omit<OwnerRec, "id">): Promise<OwnerRec>;

  createSession(s: Omit<SessionRec, "id">, meta?: { ip?: string | undefined; userAgent?: string | undefined }): Promise<SessionRec>;
  findSession(tokenHash: string): Promise<SessionRec | null>;
  deleteSession(tokenHash: string): Promise<void>;

  listWorkspaces(ownerId: string): Promise<WorkspaceRec[]>;
  listAccounts(ownerId: string): Promise<AccountRec[]>;
  /** Upserts the list; removing an account that still has transactions throws ConflictError. Atomic. */
  replaceAccounts(ownerId: string, items: AccountRec[]): Promise<AccountRec[]>;

  listTxns(ownerId: string, f?: TxnFilter): Promise<{ items: TxnRec[]; total: number }>;
  getTxn(ownerId: string, id: string): Promise<TxnRec | null>;
  /** All-or-nothing. Throws DuplicateRefError if any ref already exists on that account. */
  createTxns(ownerId: string, items: TxnInput[]): Promise<TxnRec[]>;
  updateTxn(ownerId: string, id: string, t: TxnInput): Promise<TxnRec>;
  deleteTxns(ownerId: string, ids: string[]): Promise<number>;

  listCategories(ownerId: string): Promise<CategoryRec[]>;
  createCategory(ownerId: string, c: Omit<CategoryRec, "id">): Promise<CategoryRec>;

  getCollection<K extends CollectionKey>(ownerId: string, key: K): Promise<Collections[K]>;
  replaceCollection<K extends CollectionKey>(ownerId: string, key: K, items: Collections[K]): Promise<Collections[K]>;

  createImport(ownerId: string, i: Omit<ImportRec, "id" | "createdAt">): Promise<ImportRec>;
  getImport(ownerId: string, id: string): Promise<ImportRec | null>;
  listImports(ownerId: string): Promise<ImportRec[]>; // newest first, without rows
  findImportsByHash(ownerId: string, accountId: string, fileHash: string): Promise<ImportRec[]>;
  updateImport(ownerId: string, id: string, patch: Partial<Pick<ImportRec, "status" | "error" | "summary" | "rows">>): Promise<ImportRec>;
  /**
   * Atomic approval: only if the import is still needs_review, creates the approved transactions (linked to the import),
   * marks it completed and clears pending rows. Throws ConflictError if already completed, DuplicateRefError on a ref clash.
   */
  completeImport(ownerId: string, id: string, txns: TxnInput[], summary: ImportRec["summary"]): Promise<TxnRec[]>;

  // ---------- AI usage (persistent budget) ----------
  /**
   * Atomically checks today's and this month's spend (settled cost + outstanding reservations) for the owner and,
   * if `reserveMicroUsd` still fits under both limits, records a reservation. Concurrent calls are serialised per owner.
   */
  reserveAi(ownerId: string, r: AiReserve): Promise<{ ok: true; id: string } | { ok: false; limit: "daily" | "monthly" }>;
  settleAi(ownerId: string, id: string, s: AiSettle): Promise<void>;
  aiUsage(ownerId: string, day: string, month: string): Promise<AiUsageSummary>;

  // ---------- Assistant conversations ----------
  listConversations(ownerId: string): Promise<ConversationRec[]>;
  getConversation(ownerId: string, id: string): Promise<(ConversationRec & { messages: ChatMessageRec[] }) | null>;
  createConversation(ownerId: string, title: string): Promise<ConversationRec>;
  addMessages(ownerId: string, conversationId: string, msgs: Omit<ChatMessageRec, "id" | "createdAt">[]): Promise<ChatMessageRec[]>;
  deleteConversation(ownerId: string, id: string): Promise<boolean>;
  /** Deletes conversations last updated before `before` (retention). Returns how many were removed. */
  purgeConversations(ownerId: string, before: Date): Promise<number>;

  audit(ownerId: string, action: string, entity: string, entityId?: string | null, detail?: unknown, ip?: string): Promise<void>;
}

export const DEFAULT_WORKSPACES: WorkspaceRec[] = [
  { key: "personal", name: "Personal", short: "Personal", kind: "personal" },
  { key: "scaleflow", name: "Business: Scale Flow", short: "Scale Flow", kind: "business" },
];

export interface AiReserve { feature: string; model: string; day: string; month: string; reserveMicroUsd: number; dailyLimitMicroUsd: number; monthlyLimitMicroUsd: number }
export interface AiSettle { status: "settled" | "failed"; model: string; costMicroUsd: number; promptTokens: number; completionTokens: number; ms: number }
export interface AiUsageSummary { dayMicroUsd: number; monthMicroUsd: number; requestsToday: number; requestsMonth: number; promptTokensMonth: number; completionTokensMonth: number }
export interface ConversationRec { id: string; title: string; createdAt: string; updatedAt: string }
export interface ChatMessageRec { id: string; role: "user" | "assistant"; content: string; data?: unknown; createdAt: string }
