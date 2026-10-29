# Money Hub AI — Backend Handoff (for Antigravity)

> Phase 2B server code now exists in `server/` — see `server/README.md`. Extra endpoint: `GET /api/accounts/balances`. Unfinished modules return 501.

Stack: Node.js + Express + Prisma + MySQL (Hostinger). OpenRouter is called **only from the server**.
Frontend types live in `src/lib/api/contracts.ts` (source of truth); calls in `src/lib/api/services.ts`; transport in `src/lib/api/client.ts`.

## Frontend environment
| Var | Where | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | frontend build | Default server address, e.g. `https://api.yourdomain.com` (no trailing slash). Users can override in Settings → Data & privacy. |

## Backend environment (suggested)
`DATABASE_URL` (mysql://…), `JWT_SECRET`, `JWT_EXPIRES_IN` (e.g. `12h`), `CORS_ORIGIN` (the frontend origin), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `UPLOAD_MAX_MB`, `PORT`.

## Conventions
- JSON everywhere except statement upload (multipart). Money = INR rupees as numbers. Dates `yyyy-mm-dd`.
- Auth: `Authorization: Bearer <token>`. Any 401 → frontend shows "Session expired" and asks to sign in again.
- Errors: `{ "message": string, "code"?: string, "details"?: [{ "field", "message" }] }` with 400/401/403/404/409/422/5xx.
- CORS must allow the frontend origin, `Authorization` and `Content-Type` headers. No cookies are used.
- Every row is scoped to the signed-in user; never trust a `userId` from the client.
- Finance rules must match `src/lib/finance/calc.ts`: transfers, credit-card payments and loan principal are never income/expense; only loan interest is an expense. Duplicate rule: same bank `ref` = skip; look-alikes without ref = flag for review.

## Endpoints
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` (public) | — | `HealthResponse` |
| POST | `/api/auth/login` (public) | `LoginRequest` | `LoginResponse` |
| POST | `/api/auth/logout` | — | 204 |
| GET | `/api/auth/me` | — | `AuthUser` |
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
| POST | `/api/statements` (multipart: `file, accountId, workspace`) | — | `StatementImport` |
| GET | `/api/statements`, `/api/statements/:id` | — | `StatementImport[]` / `StatementImport` |
| GET | `/api/statements/:id/review` | — | `ReviewItem[]` |
| POST | `/api/statements/:id/review` | `{ decisions: ReviewDecision[] }` | `{ created, skipped }` |
| POST | `/api/ai/chat` | `ChatRequest` | `ChatResponse` |

Statement status flow: `uploaded → processing → needs_review → completed` (or `failed` with `error`). Nothing is written to the ledger until the review POST.

## Frontend behaviour already built
- **Preview**: demo data in the browser only, no network calls.
- **Production**: sign-in screen → `/api/bootstrap`. If the server is unreachable, a "Can't reach Money Hub" screen appears with retry; demo data is never shown. Sign-out in the header. Session auto-expires at `expiresAt`.
- Switch modes in Settings → Data & privacy → "App mode & server" (with a "Test" button that calls `/api/health`).

## Handoff steps
1. Build the endpoints above with Prisma models mirroring `src/lib/finance/types.ts`.
2. Deploy to Hostinger with HTTPS; set CORS to the frontend origin.
3. Set `VITE_API_BASE_URL` (or enter the address in Settings), press Test, switch to Production, sign in.
