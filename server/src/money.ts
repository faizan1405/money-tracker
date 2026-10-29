/**
 * Exact money handling. Inside the server every amount is an integer number of paise.
 * The frontend contract uses rupees (max 2 decimals); conversion happens only at the API edge.
 */
export class MoneyError extends Error {}

const MAX_PAISE = Number.MAX_SAFE_INTEGER;

/** Rupees (number or string) → integer paise. Rejects more than 2 decimals, NaN and unsafe sizes. */
export function toPaise(rupees: number | string): number {
  const s = typeof rupees === "number" ? rupeesToString(rupees) : rupees.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new MoneyError(`Invalid amount: ${rupees}`);
  const whole = m[2]!;
  const frac = (m[3] ?? "").padEnd(2, "0");
  const p = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(p) || p > MAX_PAISE) throw new MoneyError("Amount too large");
  return m[1] ? -p : p;
}

function rupeesToString(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyError("Amount must be a finite number");
  // Use up to 10 decimals then validate; e.g. 0.1+0.2 → "0.3000000000" → trimmed to "0.3".
  return n.toFixed(10).replace(/\.?0+$/, "");
}

/** Integer paise → rupees number for JSON. Exact for any 2-decimal value. */
export function toRupees(paise: number | bigint): number {
  const p = typeof paise === "bigint" ? Number(paise) : paise;
  if (!Number.isSafeInteger(p)) throw new MoneyError("Unsafe paise value");
  return p / 100;
}

export function bigToPaise(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new MoneyError("Stored amount out of range");
  return n;
}
