/**
 * Typed API contracts shared with the external backend (Node + Prisma + MySQL).
 * All money values are INR amounts as numbers (rupees, 2dp). Dates are ISO yyyy-mm-dd.
 * Every list endpoint is scoped to the signed-in user; workspace filtering via ?workspace=.
 */
import type { Account, Budget, Due, Goal, Recurring, Rule, Transaction, TxnType, WorkspaceId } from "@/lib/finance/types";

export interface ApiErrorBody {
  message: string;
  code?: string;
  details?: { field: string; message: string }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- Auth ----
export interface LoginRequest { email: string; password: string }
export interface AuthUser { id: string; email: string; name: string }
/** The session itself travels only in an HttpOnly cookie; no token is ever returned to JavaScript. */
export interface LoginResponse { expiresAt: string; user: AuthUser }
export type MeResponse = LoginResponse;

// ---- Workspaces ----
export interface WorkspaceDTO { id: WorkspaceId | string; name: string; short: string; kind: "personal" | "business" }

// ---- Categories ----
export interface CategoryDTO { id: string; name: string; workspace: WorkspaceId; kind: "income" | "expense"; custom: boolean }

// ---- Transactions ----
export type TransactionDTO = Transaction;
export type CreateTransaction = Omit<Transaction, "id">;
export interface TransactionQuery {
  workspace?: WorkspaceId;
  from?: string;
  to?: string;
  type?: TxnType;
  accountId?: string;
  category?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

// ---- Analytics ----
export interface AnalyticsSummary {
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  byCategory: { category: string; amount: number }[];
  byMonth: { month: string; income: number; expense: number }[];
}

// ---- Bootstrap (one call to hydrate the app) ----
export interface BootstrapResponse {
  user: AuthUser;
  workspaces: WorkspaceDTO[];
  accounts: Account[];
  transactions: Transaction[];
  dues: Due[];
  budgets: Budget[];
  goals: Goal[];
  recurring: Recurring[];
  rules: Rule[];
  customCategories: string[];
}

/** Collections the app can save as a whole list (PUT replaces). */
export type CollectionKey = "accounts" | "dues" | "budgets" | "goals" | "recurring" | "rules" | "customCategories";

// ---- Statement imports + AI (processed server-side via OpenRouter) ----
export type ImportStatus = "uploaded" | "processing" | "needs_review" | "completed" | "failed";
export interface ImportSummary {
  found: number;
  duplicates: number;
  flagged: number;
  period?: { from: string; to: string };
  accountLast4?: string;
  accountMatches?: boolean;
  /** Computed by the server from statement numbers only; AI never touches balances. */
  reconciliation: { status: "balanced" | "mismatch" | "unclear" | "unavailable"; opening?: number; closing?: number; credits: number; debits: number; difference?: number; brokenRows: number[] };
  ai: { status: "used" | "not_configured" | "failed" | "not_needed"; message?: string; model?: string; costUsd?: number; calls?: number };
  warnings: string[];
  sameFileImportedBefore?: boolean;
  created?: number;
  skipped?: number;
}
export interface StatementImport {
  id: string;
  fileName: string;
  accountId: string;
  workspace: WorkspaceId;
  status: ImportStatus;
  createdAt: string;
  error?: string;
  summary?: ImportSummary;
}
export interface ReviewItem {
  id: string;
  importId: string;
  line: number;
  date: string;
  time?: string;
  direction: "debit" | "credit" | "unknown";
  amount: number;
  ref?: string;
  balance?: number;
  description: string;
  proposed: CreateTransaction;
  confidence: number; // 0..1
  reason?: string;
  source: "rule" | "ai" | "none";
  flags: string[];
  duplicate: "none" | "exact" | "possible";
  matchedTransactionId?: string;
}
export interface ReviewEdit {
  type?: TxnType;
  category?: string;
  subcategory?: string;
  merchant?: string;
  description?: string;
  workspace?: WorkspaceId | string;
  /** For transfers / card payments: the user's other account. */
  otherAccountId?: string;
  interest?: number;
}
export interface ReviewDecision { id: string; decision: "accept" | "skip"; edited?: ReviewEdit; remember?: boolean }

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ChatRequest { messages: ChatMessage[]; workspace?: WorkspaceId | "all" }
export interface ChatResponse {
  reply: string;
  rows?: { label: string; value: string; tone?: "positive" | "negative" }[];
  sources?: { transactionId: string }[];
}

export interface HealthResponse { ok: boolean; version: string }
