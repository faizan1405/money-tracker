/** Date ranges in India time. All dates are yyyy-mm-dd calendar days. */
export const PERIODS = ["this_month", "last_month", "this_week", "last_30_days", "last_90_days", "this_year", "last_year", "this_financial_year", "last_financial_year", "all_time", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];
export interface Range { from: string; to: string; label: string; partial?: boolean }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const addDays = (s: string, n: number) => { const [y, m, d] = parts(s); return iso(y, m - 1, d + n); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const istToday = (nowMs: number) => new Date(nowMs + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Indian date, e.g. "1 Oct 2026". */
export function fmtDate(s: string) { const [y, m, d] = parts(s); return `${d} ${MONTHS[m - 1]} ${y}`; }
export function rangeLabel(from: string, to: string) { return from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`; }
const mk = (from: string, to: string, partial = false): Range => ({ from, to, label: rangeLabel(from, to), ...(partial ? { partial } : {}) });

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && iso(...(() => { const [y, m, d] = parts(s); return [y, m - 1, d] as const; })()) === s;

export function resolvePeriod(p: PeriodKey, today: string, custom?: { from?: string | null; to?: string | null }): Range {
  const [y, m] = parts(today);
  const fyStart = m >= 4 ? y : y - 1;
  switch (p) {
    case "this_month": return mk(iso(y, m - 1, 1), today, today !== iso(y, m - 1, lastDay(y, m - 1)));
    case "last_month": return mk(iso(y, m - 2, 1), iso(y, m - 1, 0));
    case "this_week": { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; return mk(addDays(today, -dow), today, dow < 6); }
    case "last_30_days": return mk(addDays(today, -29), today);
    case "last_90_days": return mk(addDays(today, -89), today);
    case "this_year": return mk(iso(y, 0, 1), today, true);
    case "last_year": return mk(iso(y - 1, 0, 1), iso(y - 1, 11, 31));
    case "this_financial_year": return mk(iso(fyStart, 3, 1), today, true);
    case "last_financial_year": return mk(iso(fyStart - 1, 3, 1), iso(fyStart, 2, 31));
    case "all_time": return mk("2000-01-01", today);
    case "custom": {
      let from = isDate(custom?.from) ? custom!.from! : iso(y, m - 1, 1);
      let to = isDate(custom?.to) ? custom!.to! : today;
      if (to > today) to = today;
      if (from > to) [from, to] = [to, from];
      return mk(from, to);
    }
  }
}

/** The comparison window: the previous calendar month/year for month/year periods, else the same length just before. */
export function previousPeriod(p: PeriodKey, r: Range): Range {
  const [fy, fm, fd] = parts(r.from);
  if (p === "this_month" || p === "last_month") return mk(iso(fy, fm - 2, 1), iso(fy, fm - 1, 0));
  if (p === "this_year" || p === "this_financial_year") return mk(iso(fy - 1, fm - 1, fd), (() => { const [ty, tm, td] = parts(r.to); return iso(ty - 1, tm - 1, Math.min(td, lastDay(ty - 1, tm - 1))); })());
  if (p === "last_year" || p === "last_financial_year") return mk(iso(fy - 1, fm - 1, fd), addDays(r.from, -1));
  const len = daysBetween(r.from, r.to);
  return mk(addDays(r.from, -len - 1), addDays(r.from, -1));
}

/** Calendar months touched by a range, oldest first (yyyy-mm). */
export function monthsBack(today: string, n: number) {
  const [y, m] = parts(today);
  return Array.from({ length: n }, (_, i) => iso(y, m - 1 - (n - 1 - i), 1).slice(0, 7));
}
export const monthLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return `${MONTHS[m - 1]} ${y}`; };
export const monthRange = (ym: string, today: string): Range => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const end = iso(y, m - 1, lastDay(y, m - 1));
  return mk(`${ym}-01`, end > today ? today : end, end > today);
};
