# Money Hub AI — API server (Phase 2B)

Node 20+ · TypeScript · Express · Prisma · MySQL/MariaDB. Separate from the Lovable frontend in `../src`.
API contract: `../src/lib/api/contracts.ts` and `../docs/BACKEND_HANDOFF.md`.

## Layout
```
prisma/schema.prisma          18 tables, money = BigInt paise
prisma/migrations/0001_init   initial SQL
src/app.ts                    routes, CORS, rate limit, validation
src/auth.ts                   scrypt hashing, sessions, cookie + bearer, CSRF origin check
src/domain/ledger.ts          finance rules (same as frontend calc.ts), integer paise
src/money.ts                  rupee ↔ paise conversion (rejects > 2 decimals)
src/dto.ts                    zod schemas + DTO mapping
src/repo/prisma.ts            MySQL storage (atomic batches, ownership on every query)
src/repo/memory.ts            test-only storage
src/ai/index.ts               interfaces for the later OpenRouter phase (routes return 501)
scripts/create-owner.ts       one-time owner setup (no public sign-up)
test/                         automated tests
```

## Local development
```bash
cd server
cp .env.example .env               # set DATABASE_URL, CORS_ORIGIN=http://localhost:8080, NODE_ENV=development, CROSS_SITE_COOKIES=false
npm install
npx prisma migrate deploy          # creates tables
OWNER_EMAIL=you@example.com OWNER_NAME="Faizan" npm run owner:create
npm run dev                        # http://localhost:4000/api/health
```
In the app: Settings → Data & privacy → server address `http://localhost:4000` → Test → Production → sign in.

## Tests
```bash
npm test                                                     # quick, in-memory storage
TEST_DATABASE_URL="mysql://user:pass@127.0.0.1:3306/moneyhub_test" npm test   # real database (WIPES that database)
```
Use a separate, empty test database. Never point TEST_DATABASE_URL at production.

## Security model
- Passwords: scrypt (N=2^15, r=8), timing-safe compare; unknown emails take the same time.
- Sessions: 32-byte random token, only its SHA-256 is stored; expiry enforced server-side (`SESSION_TTL_HOURS`).
- The session lives **only** in an HttpOnly cookie (`mh_session`, path `/api`). It is never returned in a response body and Bearer headers are not accepted. The frontend calls `/api/auth/me` on load to restore the session after a refresh.
- Cookie flags: `HttpOnly`; `Secure` in production; `SameSite=None` when `CROSS_SITE_COOKIES=true` (frontend and API on different sites), otherwise `SameSite=Strict`.
- CSRF: every write — including login — must carry an `Origin` listed in `CORS_ORIGIN`; combined with SameSite this blocks forged requests.
- Dates: timestamps are stored as the Asia/Kolkata calendar day.
- Login rate limit: 10 tries / 15 min per IP + email.
- Every query filters by the signed-in owner; accounts used in a transaction must belong to that owner.
- Helmet headers, CORS limited to exact origins, JSON body limit 2 MB.

## Finance guarantees
- All money stored as integer paise (BigInt). No floating-point sums.
- Transfers / card bill payments / loan principal are never income or expense; loan interest is an expense; refunds reduce spending.
- Totals and balances are derived from stored transactions on every request, so edits and deletes are always reflected.
- `@@unique(ownerId, accountId, ref)`: the same bank reference can't be saved twice. Look-alikes without a reference are allowed (user decides).
- Multi-row saves run in one database transaction: one bad row → nothing saved.
- An account that still has transactions can't be deleted (database-level restriction).

## Frontend ↔ API configuration
- Node.js **20 or newer** (tested on 22).
- Frontend: set `VITE_API_BASE_URL=https://api.yourdomain.com` at build time, or enter the address in Settings → Data & privacy.
- API: `CORS_ORIGIN` must be the exact frontend origin(s), e.g. `https://moneyhub.yourdomain.com`.
- Best setup: frontend and API on the same site (e.g. `app.yourdomain.com` + `api.yourdomain.com`) → set `CROSS_SITE_COOKIES=false` (SameSite=Strict). If they are on different sites (e.g. `*.lovable.app` + your domain) use `CROSS_SITE_COOKIES=true`; note some browsers (Safari) block third-party cookies, so the same-site setup is strongly recommended.
- Both must use HTTPS in production (cookies are `Secure`).

## Hostinger deployment (not done yet — needs your approval)
Requires a plan that runs **Node.js apps** (Business/Cloud web hosting with the Node.js app feature, or a VPS). Plain shared hosting without Node can't run this server.

1. hPanel → Databases → create MySQL database + user (access to that database only). Copy host/port.
2. Upload the `server/` folder (without `node_modules`) or connect the Git repo with the app root set to `server`.
3. Set environment variables in hPanel (from `.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `CORS_ORIGIN` (the exact frontend URL), `SESSION_TTL_HOURS`, `CROSS_SITE_COOKIES=true` if the frontend is on a different domain.
4. Build command: `npm ci && npm run build` · Start command: `npm start` · Entry: `dist/index.js`.
5. Run once: `npx prisma migrate deploy`, then `npm run owner:create` (SSH).
6. Enable HTTPS (SSL) for the API domain, e.g. `api.yourdomain.com`.
7. Check `https://api.yourdomain.com/api/health` → `{"ok":true}`. Then set the address in the app and switch to Production.

On a VPS: same steps, run with `pm2 start dist/index.js --name moneyhub`, put Nginx in front with HTTPS.

## Backups & recovery
- Enable Hostinger daily backups for the database.
- Extra: nightly `mysqldump --single-transaction --routines DB | gzip > moneyhub-$(date +%F).sql.gz`, keep 30 days off-server.
- Restore: `gunzip < file.sql.gz | mysql DB`, then `npx prisma migrate deploy` to confirm the schema is current.
- Test a restore into a scratch database at least once.

## Not implemented yet (endpoints return 501)
Statement upload/processing, AI chat/categorisation (OpenRouter), invoices, clients, projects, reports.
Tables for invoices, client payments, projects, loan repayments, imports and audit logs already exist.
