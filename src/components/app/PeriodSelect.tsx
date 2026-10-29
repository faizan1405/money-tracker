import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useFinance, useScoped } from "@/lib/finance/store";
import { inRange, periodRange, previousRange } from "@/lib/finance/calc";
import type { Period } from "@/lib/finance/types";

export const PERIOD_LABEL: Record<Period, string> = { week: "This Week", month: "This Month", last_month: "Last Month", year: "This Year", custom: "Custom Range" };

export function PeriodSelect() {
  const { period, setPeriod, custom, setCustom } = useFinance();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <SelectTrigger className="w-[150px] bg-card"><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <SelectItem key={p} value={p}>{PERIOD_LABEL[p]}</SelectItem>)}</SelectContent>
      </Select>
      {period === "custom" && (
        <>
          <Input type="date" aria-label="From" className="w-[150px] bg-card" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <Input type="date" aria-label="To" className="w-[150px] bg-card" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

/** Scoped transactions for the selected period and the equivalent previous period. */
export function usePeriodTxns() {
  const { period, custom } = useFinance();
  const { txns } = useScoped();
  return useMemo(() => {
    const range = periodRange(period, new Date(), custom);
    const prev = previousRange(range);
    return { range, current: txns.filter((t) => inRange(t, range)), previous: txns.filter((t) => inRange(t, prev)) };
  }, [txns, period, custom]);
}
