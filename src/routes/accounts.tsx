import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeftRight, Banknote, CreditCard, Landmark, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFinance, useScoped } from "@/lib/finance/store";
import { accountBalance } from "@/lib/finance/calc";
import { formatINR } from "@/lib/finance/format";
import type { AccountKind } from "@/lib/finance/types";
import { PageHeader, Panel, Pill, Progress } from "@/components/app/ui-bits";
import { TxnList } from "@/components/app/TxnList";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/accounts")({
  head: () => ({
    meta: [
      { title: "Accounts — Money Hub AI" },
      { name: "description", content: "Bank accounts, UPI, cash, wallets and credit cards in one place." },
      { property: "og:title", content: "Accounts — Money Hub AI" },
      { property: "og:description", content: "Bank accounts, UPI, cash, wallets and credit cards in one place." },
    ],
  }),
  component: Accounts,
});

const KIND: Record<AccountKind, { label: string; icon: LucideIcon }> = {
  bank: { label: "Bank", icon: Landmark }, cash: { label: "Cash", icon: Banknote }, upi: { label: "UPI", icon: Smartphone },
  credit_card: { label: "Credit card", icon: CreditCard }, wallet: { label: "Wallet", icon: Wallet },
};

function Accounts() {
  const f = useFinance();
  const { accounts } = useScoped();
  const [sel, setSel] = useState(accounts[0]?.id);
  const selected = accounts.find((a) => a.id === sel) ?? accounts[0];
  const assets = accounts.filter((a) => a.kind !== "credit_card").reduce((s, a) => s + accountBalance(a, f.txns), 0);
  const cardDebt = accounts.filter((a) => a.kind === "credit_card").reduce((s, a) => s + accountBalance(a, f.txns), 0);
  const history = selected ? f.txns.filter((t) => t.accountId === selected.id || t.toAccountId === selected.id) : [];

  return (
    <>
      <PageHeader title="Accounts & balances" subtitle="Balances are calculated from every transaction — transfers move money, they don't create it."
        actions={<Button onClick={() => f.openAdd({ type: "transfer", category: "Transfer", merchant: "Self transfer", accountId: "hdfc", toAccountId: "cash" })}><ArrowLeftRight className="size-4" />Transfer</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="surface p-4"><div className="text-xs text-muted-foreground">Cash & bank</div><div className="num mt-2 text-2xl font-semibold">{formatINR(assets)}</div></div>
        <div className="surface p-4"><div className="text-xs text-muted-foreground">Credit card dues</div><div className="num mt-2 text-2xl font-semibold text-negative">{formatINR(-cardDebt)}</div></div>
        <div className="surface col-span-2 p-4 lg:col-span-1"><div className="text-xs text-muted-foreground">Net liquid position</div><div className="num mt-2 text-2xl font-semibold">{formatINR(assets + cardDebt)}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-2">
          {accounts.map((a) => {
            const K = KIND[a.kind];
            const bal = accountBalance(a, f.txns);
            return (
              <button key={a.id} onClick={() => setSel(a.id)} className={cn("surface flex w-full items-center gap-3 p-4 text-left transition-all hover:shadow-lift", selected?.id === a.id && "ring-2 ring-primary")}>
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary"><K.icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{K.label}{a.last4 && ` ·· ${a.last4}`} · {a.workspace === "personal" ? "Personal" : "Scale Flow"}</div>
                </div>
                <div className="text-right">
                  <div className={cn("num font-semibold", bal < 0 && "text-negative")}>{formatINR(bal)}</div>
                  <Pill tone={a.reconciled === "reconciled" ? "positive" : a.reconciled === "pending" ? "warning" : "neutral"}>{a.reconciled === "reconciled" ? "Reconciled" : a.reconciled === "pending" ? "Needs review" : "Not reconciled"}</Pill>
                </div>
              </button>
            );
          })}
        </div>
        {selected && (
          <Panel title={`${selected.name} · history`}>
            {selected.kind === "credit_card" && selected.creditLimit && (
              <div className="mb-4 rounded-xl bg-secondary p-3 text-sm">
                <div className="mb-2 flex justify-between"><span>Used of {formatINR(selected.creditLimit)} limit</span><span className="num font-semibold">{formatINR(-accountBalance(selected, f.txns))}</span></div>
                <Progress value={(-accountBalance(selected, f.txns) / selected.creditLimit) * 100} />
                <p className="mt-2 text-xs text-muted-foreground">Card purchases count as expenses once. Paying the bill lowers your bank balance and this card's dues — it isn't counted as a new expense.</p>
              </div>
            )}
            <p className="mb-2 text-xs text-muted-foreground">Statement reconciliation will be available when statement processing is connected.</p>
            <TxnList txns={history.slice(0, 40)} />
          </Panel>
        )}
      </div>
    </>
  );
}
