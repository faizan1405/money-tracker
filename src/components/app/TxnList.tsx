import { useFinance } from "@/lib/finance/store";
import { formatDateTime } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/types";
import { Amount, CategoryIcon, Pill, TYPE_LABEL } from "./ui-bits";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function TxnList({ txns, selectable, selected, onToggle, compact }: {
  txns: Transaction[]; selectable?: boolean; selected?: Set<string>; onToggle?: (id: string) => void; compact?: boolean;
}) {
  const { accounts, openEdit } = useFinance();
  const acc = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  return (
    <ul className="divide-y divide-border">
      {txns.map((t) => (
        <li key={t.id} className={cn("flex items-center gap-3 py-3", selected?.has(t.id) && "bg-primary-soft/40")}>
          {selectable && <Checkbox checked={!!selected?.has(t.id)} onCheckedChange={() => { onToggle?.(t.id); }} aria-label={`Select ${t.merchant}`} />}
          <button onClick={() => openEdit(t)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <CategoryIcon category={t.category} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{t.merchant}</span>
                {t.status === "pending" && <Pill tone="warning">Pending</Pill>}
                {t.source === "statement" && <Pill tone="info">Imported</Pill>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {t.category} · {t.type === "transfer" || t.type === "cc_payment" ? `${acc(t.accountId)} → ${acc(t.toAccountId)}` : acc(t.accountId)}
                {!compact && <> · {formatDateTime(t.date)}</>}
              </div>
            </div>
            <div className="text-right">
              <Amount t={t} className="text-sm" />
              <div className="text-[11px] text-muted-foreground">
                {compact ? formatDateTime(t.date) : `${TYPE_LABEL[t.type]} · ${t.workspace === "personal" ? "Personal" : "Scale Flow"}`}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
