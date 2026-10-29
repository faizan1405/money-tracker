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
- Phase 1 is frontend-only: state lives in `src/lib/finance/store.tsx` (React context + localStorage) so it can later be swapped for a real API without touching pages.
