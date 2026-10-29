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

/** Assistant: every amount is computed by the backend (paise); the AI only explains them. */
export interface ChatRequest { message: string; conversationId?: string; workspace?: WorkspaceId | "all" | string }
export interface AssistantRange { from: string; to: string; label: string; partial?: boolean }
export interface AssistantFigure { key: string; label: string; paise?: number; text?: string; tone?: "positive" | "negative" }
export interface AssistantFacts {
  metric: string;
  workspace: string;
  workspaceLabel: string;
  period: AssistantRange;
  comparePeriod?: AssistantRange;
  figures: AssistantFigure[];
  rowsTitle?: string;
  rows?: { label: string; paise: number; sub?: string }[];
  transactions?: { id: string; date: string; merchant: string; category: string; paise: number }[];
  chart?: { title: string; series: string[]; points: { label: string; a: number; b?: number }[] };
  notes: string[];
  empty: boolean;
}
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  facts?: AssistantFacts;
  suggestions?: string[];
  language?: "en" | "hi" | "hinglish";
  /** false → the AI explanation was unavailable or failed checks; the text is a plain backend summary. */
  aiExplained?: boolean;
  context?: { metric: string; workspace: string; period: string };
}
export interface ChatResponse { conversationId: string; message: AssistantMessage; usage: { costUsd: number; ms: number; calls: number } }
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string }
export interface ConversationDetail extends ConversationSummary { messages: AssistantMessage[] }
export interface Insight {
  id: string;
  kind: string;
  severity: "info" | "warning" | "alert";
  title: string;
  detail: string;
  period: string;
  figures: { label: string; value: string }[];
  transactionIds?: string[];
}
export interface InsightsResponse { workspace: string; asOf: string; items: Insight[] }
export interface InsightSuggestions { suggestions: { text: string; basedOn: string }[]; usage?: { costUsd: number; ms: number } }
export interface AiUsageResponse {
  configured: boolean; day: string; month: string; models: { fast: string; strong: string } | null;
  spentTodayUsd: number; spentMonthUsd: number; requestsToday: number; requestsMonth: number; promptTokensMonth: number; completionTokensMonth: number;
  limits: { perRequestUsd: number; dailyUsd: number; monthlyUsd: number } | null;
}

export interface HealthResponse { ok: boolean; version: string }
