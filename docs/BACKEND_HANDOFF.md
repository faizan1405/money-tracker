# Money Hub AI — Backend Handoff (for Antigravity)

> Server code lives in `server/` — see `server/README.md`. Phase 3A added real statement import + AI review. Extra endpoints: `GET /api/accounts/balances`, `POST /api/statements/:id/discard`. Unfinished modules return 501.

Stack: Node.js + Express + Prisma + MySQL (Hostinger). OpenRouter is called **only from the server**.
Frontend types live in `src/lib/api/contracts.ts` (source of truth); calls in `src/lib/api/services.ts`; transport in `src/lib/api/client.ts`.

## Frontend environment
| Var | Where | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | frontend build | Default server address, e.g. `https://api.yourdomain.com` (no trailing slash). Users can override in Settings → Data & privacy. |

## Backend environment (suggested)
`DATABASE_URL` (mysql://…), `JWT_SECRET`, `JWT_EXPIRES_IN` (e.g. `12h`), `CORS_ORIGIN` (the frontend origin), `OPENROUTER_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_STRONG`, `AI_MAX_COST_PER_STATEMENT_USD`, `AI_DAILY_COST_LIMIT_USD`, `UPLOAD_MAX_MB`, `PORT`.

## Conventions
- JSON everywhere except statement upload (multipart). Money = INR rupees as numbers. Dates `yyyy-mm-dd`.
- Auth: HttpOnly session cookie only (`credentials: include`); no token in responses or browser storage. `GET /api/auth/me` returns `{ user, expiresAt }`. A 401 with code `session_expired` → frontend shows "Your session expired".
- Errors: `{ "message": string, "code"?: string, "details"?: [{ "field", "message" }] }` with 400/401/403/404/409/422/5xx.
- CORS allows only the exact frontend origin with credentials. Every write (including login) must send an allowed `Origin` (CSRF).
- Every row is scoped to the signed-in user; never trust a `userId` from the client.
- Finance rules must match `src/lib/finance/calc.ts`: transfers, credit-card payments and loan principal are never income/expense; only loan interest is an expense. Duplicate rule: same bank `ref` = skip; look-alikes without ref = flag for review.

## Endpoints
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` (public) | — | `HealthResponse` |
| POST | `/api/auth/login` (public) | `LoginRequest` | `LoginResponse` `{ expiresAt, user }` + Set-Cookie |
| POST | `/api/auth/logout` | — | 204 |
| GET | `/api/auth/me` | — | `{ expiresAt, user }` |
| GET | `/api/bootstrap` | — | `BootstrapResponse` (loaded once after sign-in) |
| GET | `/api/workspaces` | — | `WorkspaceDTO[]` |
| GET/POST | `/api/categories` | `CategoryDTO` (no id) | `CategoryDTO[]` / `CategoryDTO` |
| GET | `/api/transactions?workspace&from&to&type&accountId&category&q&page&pageSize` | — | `Paginated<Transaction>` |
| POST | `/api/transactions` | `{ items: CreateTransaction[] }` | `Transaction[]` (with server ids) |
| PATCH | `/api/transactions/:id` | `Partial<Transaction>` | `Transaction` |
| POST | `/api/transactions/delete` | `{ ids: string[] }` | 204 |
| GET | `/api/accounts`, `/api/dues`, `/api/budgets` | — | lists |
| PUT | `/api/collections/:key` (`accounts,dues,budgets,goals,recurring,rules,customCategories`) | `{ items: [...] }` | saved list (full replace) |
| GET | `/api/analytics/summary?from&to&workspace` | — | `AnalyticsSummary` |
| POST | `/api/statements` (multipart: `accountId, workspace, password?, file`) | — | `StatementImport` (422 codes: `password_required`, `bad_password`, `scanned`, `unreadable`, `unsupported`; 415 for other file types) |
| GET | `/api/statements`, `/api/statements/:id` | — | `StatementImport[]` / `StatementImport` |
| GET | `/api/statements/:id/review` | — | `ReviewItem[]` |
| POST | `/api/statements/:id/review` | `{ decisions: ReviewDecision[] }` | `{ created, skipped, rulesLearned }` (409 if already saved) |
| POST | `/api/ai/chat` | `ChatRequest` (`message` ≤ 500 chars, `conversationId?`, `workspace?`) | `ChatResponse` (429 `ai_budget_exceeded`/`rate_limited`, 504 `ai_timeout`, 503 `ai_not_configured`) |
| GET | `/api/ai/conversations` | — | `{ items: ConversationSummary[], retentionDays }` |
| GET / DELETE | `/api/ai/conversations/:id` | — | `ConversationDetail` / 204 |
| GET | `/api/ai/insights?workspace` | — | `InsightsResponse` (verified, no AI) |
| POST | `/api/ai/insights/suggest` | `{ workspace }` | `InsightSuggestions` (AI ideas, each tied to an insight id) |
| GET | `/api/ai/usage` | — | `AiUsageResponse` |

Statement status flow: `uploaded → processing → needs_review → completed` (or `failed` with `error`). Nothing is written to the ledger until the review POST.

## Frontend behaviour already built
- **Preview**: demo data in the browser only, no network calls.
- **Production**: sign-in screen → `/api/bootstrap`. If the server is unreachable, a "Can't reach Money Hub" screen appears with retry; demo data is never shown. Sign-out in the header. Session auto-expires at `expiresAt`.
- Switch modes in Settings → Data & privacy → "App mode & server" (with a "Test" button that calls `/api/health`).

## Handoff steps
1. Build the endpoints above with Prisma models mirroring `src/lib/finance/types.ts`.
2. Deploy to Hostinger with HTTPS; set CORS to the frontend origin.
3. Set `VITE_API_BASE_URL` (or enter the address in Settings), press Test, switch to Production, sign in.
