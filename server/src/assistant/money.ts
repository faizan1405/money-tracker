/** INR display used in every assistant answer (Indian digit grouping). The validator compares against these exact strings. */
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(paise: number) {
  const s = paise % 100 === 0 ? whole.format(paise / 100) : exact.format(paise / 100);
  return s.replace(/\u00a0/g, " ");
}

/** Every rupee amount that appears in a piece of text, as integer paise. Handles ₹1,23,456.50, Rs. 500 and INR 2,000. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₹|\bRs\.?|\bINR)\s?(-?[\d,]+(?:\.\d{1,2})?)/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(Math.round(Math.abs(n) * 100));
  }
  return out;
}

export const pct = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);
