import { apiRequest } from "./client";
import type {
  AiUsageResponse, AnalyticsSummary, BootstrapResponse, ConversationDetail, ConversationSummary, InsightSuggestions, InsightsResponse, CategoryDTO, ChatRequest, ChatResponse, CollectionKey, CreateTransaction,
  HealthResponse, LoginRequest, LoginResponse, Paginated, ReviewDecision, ReviewItem, StatementImport, TransactionDTO,
  TransactionQuery, WorkspaceDTO,
} from "./contracts";
import type { Account, Budget, Due } from "@/lib/finance/types";

const qs = (o: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const healthApi = { check: (baseUrl?: string) => apiRequest<HealthResponse>("/api/health", { auth: false, baseUrl }) };

export const authApi = {
  login: (b: LoginRequest) => apiRequest<LoginResponse>("/api/auth/login", { method: "POST", body: b, auth: false }),
  logout: () => apiRequest<void>("/api/auth/logout", { method: "POST" }),
  me: () => apiRequest<LoginResponse>("/api/auth/me", { auth: false }),
};

export const bootstrapApi = { load: () => apiRequest<BootstrapResponse>("/api/bootstrap") };

export const workspacesApi = { list: () => apiRequest<WorkspaceDTO[]>("/api/workspaces") };
export const categoriesApi = {
  list: () => apiRequest<CategoryDTO[]>("/api/categories"),
  create: (b: Omit<CategoryDTO, "id">) => apiRequest<CategoryDTO>("/api/categories", { method: "POST", body: b }),
};

export const transactionsApi = {
  list: (q: TransactionQuery = {}) => apiRequest<Paginated<TransactionDTO>>(`/api/transactions${qs(q)}`),
  createMany: (items: CreateTransaction[]) => apiRequest<TransactionDTO[]>("/api/transactions", { method: "POST", body: { items } }),
  update: (id: string, patch: Partial<TransactionDTO>) => apiRequest<TransactionDTO>(`/api/transactions/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  remove: (ids: string[]) => apiRequest<void>("/api/transactions/delete", { method: "POST", body: { ids } }),
};

export const accountsApi = { list: () => apiRequest<Account[]>("/api/accounts") };
export const loansApi = { list: () => apiRequest<Due[]>("/api/dues") };
export const budgetsApi = { list: () => apiRequest<Budget[]>("/api/budgets") };

export const collectionsApi = {
  replace: <T>(key: CollectionKey, items: T) => apiRequest<T>(`/api/collections/${key}`, { method: "PUT", body: { items } }),
};

export const analyticsApi = {
  summary: (q: { from: string; to: string; workspace?: string }) => apiRequest<AnalyticsSummary>(`/api/analytics/summary${qs(q)}`),
};

/** Statement imports — AI extraction runs on the backend (OpenRouter key never reaches the browser). */
export const statementsApi = {
  upload: (file: File, accountId: string, workspace: string, password?: string) => {
    const fd = new FormData();
    fd.append("accountId", accountId);
    fd.append("workspace", workspace);
    if (password) fd.append("password", password); // used once on the server, never stored
    fd.append("file", file);
    return apiRequest<StatementImport>("/api/statements", { method: "POST", body: fd });
  },
  list: () => apiRequest<StatementImport[]>("/api/statements"),
  get: (id: string) => apiRequest<StatementImport>(`/api/statements/${encodeURIComponent(id)}`),
  review: (id: string) => apiRequest<ReviewItem[]>(`/api/statements/${encodeURIComponent(id)}/review`),
  discard: (id: string) => apiRequest<StatementImport>(`/api/statements/${encodeURIComponent(id)}/discard`, { method: "POST" }),
  decide: (id: string, decisions: ReviewDecision[]) => apiRequest<{ created: number; skipped: number; rulesLearned: number }>(`/api/statements/${encodeURIComponent(id)}/review`, { method: "POST", body: { decisions } }),
};

export const aiApi = {
  chat: (b: ChatRequest) => apiRequest<ChatResponse>("/api/ai/chat", { method: "POST", body: b }),
  conversations: () => apiRequest<{ items: ConversationSummary[]; retentionDays: number }>("/api/ai/conversations"),
  conversation: (id: string) => apiRequest<ConversationDetail>(`/api/ai/conversations/${encodeURIComponent(id)}`),
  deleteConversation: (id: string) => apiRequest<void>(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  insights: (workspace: string) => apiRequest<InsightsResponse>(`/api/ai/insights${qs({ workspace })}`),
  suggest: (workspace: string) => apiRequest<InsightSuggestions>("/api/ai/insights/suggest", { method: "POST", body: { workspace } }),
  usage: () => apiRequest<AiUsageResponse>("/api/ai/usage"),
};
