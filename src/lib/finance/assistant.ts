import { byCategory, inRange, periodRange, totals } from "./calc";
import { formatDate, formatINR } from "./format";
import type { Due, Recurring, Transaction } from "./types";

export const SUGGESTED = [
  "Where did I spend the most this month?",
  "How much profit did Scale Flow make?",
  "Compare my spending with last month.",
  "Which subscriptions are costing me the most?",
  "How much do clients still owe me?",
  "What payments are due next week?",
];

export interface Answer {
  text: string;
  rows?: { label: string; value: string; tone?: "positive" | "negative" }[];
}

/** Deterministic answers computed from preview data. Not AI. */
export function answer(q: string, txns: Transaction[], dues: Due[], recurring: Recurring[]): Answer {
  const s = q.toLowerCase();
  const month = txns.filter((t) => inRange(t, periodRange("month")));
  const last = txns.filter((t) => inRange(t, periodRange("last_month")));

  if (/profit|scale ?flow/.test(s)) {
    const m = totals(month.filter((t) => t.workspace === "scaleflow"));
    const l = totals(last.filter((t) => t.workspace === "scaleflow"));
    return {
      text: `Scale Flow's cash-based profit this month is ${formatINR(m.bizProfit)} (received ${formatINR(m.bizIncome)}, spent ${formatINR(m.bizExpense)}). Owner transfers to personal accounts are excluded.`,
      rows: [
        { label: "This month", value: formatINR(m.bizProfit), tone: m.bizProfit >= 0 ? "positive" : "negative" },
        { label: "Last month", value: formatINR(l.bizProfit) },
      ],
    };
  }
  if (/compare|last month/.test(s)) {
    const a = totals(month).expense;
    const b = totals(last).expense;
    return {
      text: `You've spent ${formatINR(a)} so far this month vs ${formatINR(b)} for all of last month.`,
      rows: byCategory(month).slice(0, 4).map((c) => {
        const prev = byCategory(last).find((x) => x.name === c.name)?.value ?? 0;
        return { label: c.name, value: `${formatINR(c.value)} (last: ${formatINR(prev)})` };
      }),
    };
  }
  if (/subscri/.test(s)) {
    const subs = recurring.slice().sort((a, b) => b.amount - a.amount);
    return { text: "Your recurring subscriptions and bills, by cost:", rows: subs.map((r) => ({ label: `${r.name} (${r.cadence})`, value: formatINR(r.amount) })) };
  }
  if (/owe me|clients|receivable/.test(s)) {
    const r = dues.filter((d) => d.direction === "owed_to_me");
    const total = r.reduce((x, d) => x + d.outstanding, 0);
    return { text: `${formatINR(total)} is still owed to you across ${r.length} records.`, rows: r.map((d) => ({ label: d.party, value: formatINR(d.outstanding) })) };
  }
  if (/due|next week|emi|upcoming/.test(s)) {
    const now = Date.now();
    const wk = now + 7 * 864e5;
    const items = [
      ...dues.filter((d) => d.direction === "i_owe" && new Date(d.dueDate).getTime() <= wk).map((d) => ({ label: `${d.party} · ${formatDate(d.dueDate)}`, value: formatINR(d.emi ?? d.outstanding), tone: new Date(d.dueDate).getTime() < now ? ("negative" as const) : undefined })),
      ...recurring.filter((r) => new Date(r.nextDate).getTime() <= wk).map((r) => ({ label: `${r.name} · ${formatDate(r.nextDate)}`, value: formatINR(r.amount) })),
    ];
    return { text: items.length ? `${items.length} payments are due in the next 7 days (overdue shown in red).` : "Nothing due in the next 7 days.", rows: items };
  }
  if (/reduce|save|cut/.test(s)) {
    const top = byCategory(month.filter((t) => t.workspace === "personal")).slice(0, 3);
    return { text: "Your three largest personal categories this month — the most room to cut back:", rows: top.map((c) => ({ label: c.name, value: formatINR(c.value) })) };
  }
  if (/increase/.test(s)) {
    const prev = byCategory(last);
    const rows = byCategory(month).map((c) => ({ ...c, d: c.value - (prev.find((p) => p.name === c.name)?.value ?? 0) })).filter((c) => c.d > 0).sort((a, b) => b.d - a.d).slice(0, 4);
    return { text: rows.length ? "Categories already above last month's total:" : "No category has exceeded last month yet.", rows: rows.map((r) => ({ label: r.name, value: `+${formatINR(r.d)}`, tone: "negative" })) };
  }
  // default: most spend
  const cats = byCategory(month).slice(0, 5);
  return {
    text: cats.length ? `Your biggest spending category this month is ${cats[0].name} at ${formatINR(cats[0].value)}.` : "No spending recorded this month yet.",
    rows: cats.map((c) => ({ label: c.name, value: formatINR(c.value) })),
  };
}
