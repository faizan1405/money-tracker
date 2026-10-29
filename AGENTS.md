<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Finance math (income/expense/balance rules) lives only in `src/lib/finance/calc.ts` and is covered by `src/test/finance-calc.test.ts`; pages never re-implement it so transfers, card payments and loan principal are never double-counted.
- App state lives in `src/lib/finance/store.tsx`; Preview mode uses localStorage demo data, Production mode loads/saves only through `src/lib/api/services.ts` and never falls back to demo data, so pages stay unchanged across modes.
- All backend calls go through `apiRequest` in `src/lib/api/client.ts` with contracts in `src/lib/api/contracts.ts` (mirrored in `docs/BACKEND_HANDOFF.md`) so the external backend has one source of truth.
- Production access is gated by `ProductionGate` + `src/lib/auth/session.tsx` (bearer token, 401 = session expired); AI keys stay on the external server.
- Duplicate detection (`matchDuplicate`/`dedupe` in calc.ts): only same-reference matches are skipped automatically; look-alikes without references are flagged for the user, so genuine repeat payments are never silently dropped.
- The real API lives in `server/` (Express + Prisma + MySQL, its own package, tests and README); it is not part of the Lovable app build. Money is integer paise there and `server/src/domain/ledger.ts` must stay in sync with `src/lib/finance/calc.ts`.
