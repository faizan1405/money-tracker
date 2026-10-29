/**
 * Deterministic statement parsing. Dates, amounts, references and balances come ONLY from here —
 * never from the AI. Amounts are parsed from text straight into integer paise (no floats).
 */
export type Direction = "debit" | "credit" | "unknown";

export interface ParsedRow {
  line: number; // 1-based row/line in the original statement
  date: string; // yyyy-mm-dd
  time?: string; // HH:MM when the statement shows it
  description: string;
  direction: Direction;
  amountPaise: number; // > 0
  ref?: string;
  balancePaise?: number;
}

export interface ParsedStatement {
  rows: ParsedRow[];
  openingPaise?: number;
  closingPaise?: number;
  accountLast4?: string;
  period?: { from: string; to: string };
  warnings: string[];
}

export class StatementParseError extends Error {
  constructor(message: string, public code: "unreadable" | "no_transactions" | "scanned" | "password_required" | "bad_password" | "unsupported") {
    super(message);
  }
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const validDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})|^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})|^(\d{1,2})[\s/-]([A-Za-z]{3,4})[,\s/-]+(\d{2,4})/;

/** Indian statements are day-first. Returns ISO date and how many characters were consumed. */
export function parseDate(raw: string): { date: string; len: number } | null {
  const s = raw.trim();
  const m = DATE_RE.exec(s);
  if (!m) return null;
  let date: string | null = null;
  if (m[1]) date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  else if (m[4]) date = validDate(year(m[6]!), Number(m[5]), Number(m[4]));
  else if (m[7]) {
    const mon = MONTHS[m[8]!.toLowerCase()];
    date = mon ? validDate(year(m[9]!), mon, Number(m[7])) : null;
  }
  return date ? { date, len: m[0].length + (raw.length - raw.trimStart().length) } : null;
}

const AMOUNT_RE = /^\(?-?(?:₹|rs\.?|inr)?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\)?$|^\(?-?(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,2})?\)?$/i;

/** "1,23,456.78" / "(500.00)" / "-12" → signed paise. Returns null for anything that isn't an exact amount. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let sign = 1;
  const drcr = /\s*(dr|cr)\.?$/i.exec(s);
  if (drcr) { if (drcr[1]!.toLowerCase() === "dr") sign = -1; s = s.slice(0, drcr.index).trim(); }
  if (!AMOUNT_RE.test(s)) return null;
  if (s.startsWith("(") && s.endsWith(")")) { sign = -sign; s = s.slice(1, -1); }
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/,/g, "");
  const [whole, frac = ""] = s.split(".");
  const p = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(p)) return null;
  return sign * p;
}

const RAILS = /\b(UPI|IMPS|NEFT|RTGS|NACH|ACH)\b/i;
/** Pulls a bank reference out of a narration only when the rail format makes it unambiguous. */
export function extractRef(desc: string): string | undefined {
  if (!RAILS.test(desc)) return undefined;
  const m = /\b(\d{12})\b/.exec(desc) ?? /\b([A-Z]{4}[RHN]?\d{9,18})\b/.exec(desc) ?? /\b(?=[A-Z0-9]*\d)([A-Z]{4}[0-9A-Z]{8,18})\b/.exec(desc);
  if (!m) return undefined;
  // A reversal reuses the original payment's reference; keep it distinct so both rows can exist.
  return /^\s*(rev|reversal|rvsl)\b/i.test(desc) ? `REV-${m[1]}` : m[1];
}

const SUMMARY = /\b(opening|closing|brought forward|carried forward|b\/f|c\/f|total|statement summary|page \d+|generated on|end of statement)\b/i;
const OPENING = /\b(opening balance|balance brought forward|b\/f)\b/i;
const CLOSING = /\b(closing balance|balance carried forward|c\/f)\b/i;
const LAST4 = /(?:a\/c|account|acct|card)\s*(?:no\.?|number|#)?\s*[:-]?\s*[X*x\d\s-]*?(\d{4})\b/i;

function finish(rows: ParsedRow[], openingPaise: number | undefined, closingPaise: number | undefined, text: string, warnings: string[]): ParsedStatement {
  if (!rows.length) throw new StatementParseError("No transactions were found in this statement.", "no_transactions");
  const dates = rows.map((r) => r.date).sort();
  const last4 = LAST4.exec(text)?.[1];
  return {
    rows, warnings,
    ...(openingPaise !== undefined ? { openingPaise } : {}),
    ...(closingPaise !== undefined ? { closingPaise } : {}),
    ...(last4 ? { accountLast4: last4 } : {}),
    period: { from: dates[0]!, to: dates[dates.length - 1]! },
  };
}

const lastAmount = (s: string) => {
  const toks = s.trim().split(/\s+/);
  for (let i = toks.length - 1; i >= 0; i--) {
    const v = parseAmount(toks.slice(i).join(" ")) ?? parseAmount(toks[i]!);
    if (v !== null) return v;
  }
  return undefined;
};

/** Direction from running balance (exact) when possible, otherwise explicit Dr/Cr markers. */
function settleDirections(rows: ParsedRow[], openingPaise: number | undefined) {
  let prev = openingPaise;
  for (const r of rows) {
    if (r.balancePaise !== undefined && prev !== undefined && r.direction === "unknown") {
      const d = r.balancePaise - prev;
      if (d === r.amountPaise) r.direction = "credit";
      else if (d === -r.amountPaise) r.direction = "debit";
    }
    if (r.balancePaise !== undefined) prev = r.balancePaise;
  }
}

// ---------------- CSV ----------------

export function parseCsvText(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.trim()));
}

const col = (h: string[], ...res: RegExp[]) => {
  for (const re of res) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; }
  return -1;
};

export function parseCsv(text: string): ParsedStatement {
  const grid = parseCsvText(text.replace(/^\uFEFF/, ""));
  const hi = grid.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /narration|description|particulars|details|remarks|transaction/i.test(c)));
  if (hi < 0) throw new StatementParseError("This CSV doesn't have a recognisable header row (Date, Description, Debit/Credit or Amount).", "unsupported");
  const h = grid[hi]!.map((c) => c.toLowerCase());
  const iDate = col(h, /^(txn|transaction|tran)\.?\s*date/, /^date$/, /date/);
  const iDesc = col(h, /narration/, /description/, /particulars/, /details/, /remarks/, /^transaction$/);
  const iRef = col(h, /utr|ref|chq|cheque/);
  const iDebit = col(h, /debit|withdrawal|^dr\.?$|paid out/);
  const iCredit = col(h, /credit|deposit|^cr\.?$|paid in/);
  const iAmount = iDebit < 0 && iCredit < 0 ? col(h, /amount/) : -1;
  const iType = col(h, /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn type)$/);
  const iBal = col(h, /balance/);
  const iTime = col(h, /^time$/);
  if (iDate < 0 || iDesc < 0 || (iDebit < 0 && iCredit < 0 && iAmount < 0)) throw new StatementParseError("The CSV is missing a date, description or amount column.", "unsupported");

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  let opening: number | undefined, closing: number | undefined;
  for (let n = hi + 1; n < grid.length; n++) {
    const r = grid[n]!;
    if (!r.some(Boolean)) continue;
    const desc = (r[iDesc] ?? "").replace(/\s+/g, " ");
    const d = parseDate(r[iDate] ?? "");
    if (!d) {
      if (OPENING.test(r.join(" "))) { opening = lastAmount(r.filter(Boolean).join(" ")) ?? opening; continue; }
      if (CLOSING.test(r.join(" "))) { closing = lastAmount(r.filter(Boolean).join(" ")) ?? closing; continue; }
      if (desc && rows.length && !(r[iDebit] || r[iCredit] || r[iAmount])) { rows[rows.length - 1]!.description += ` ${desc}`; continue; } // multi-line narration
      if (r.some(Boolean) && !SUMMARY.test(r.join(" "))) warnings.push(`Row ${n + 1} was skipped: no valid date.`);
      continue;
    }
    let amount: number | null = null, direction: Direction = "unknown";
    const dr = iDebit >= 0 ? parseAmount(r[iDebit] ?? "") : null;
    const cr = iCredit >= 0 ? parseAmount(r[iCredit] ?? "") : null;
    if (dr && dr !== 0) { amount = Math.abs(dr); direction = "debit"; }
    else if (cr && cr !== 0) { amount = Math.abs(cr); direction = "credit"; }
    else if (iAmount >= 0) {
      const raw = r[iAmount] ?? "";
      const a = parseAmount(raw);
      if (a !== null && a !== 0) {
        amount = Math.abs(a);
        const t = (r[iType] ?? "").toLowerCase();
        direction = /^(dr|debit|d)$/.test(t) ? "debit" : /^(cr|credit|c)$/.test(t) ? "credit" : /dr\.?$/i.test(raw) || a < 0 ? "debit" : /cr\.?$/i.test(raw) ? "credit" : "unknown";
      }
    }
    if (amount === null) {
      if (SUMMARY.test(desc)) continue;
      warnings.push(`Row ${n + 1} was skipped: no amount.`);
      continue;
    }
    const bal = iBal >= 0 ? parseAmount(r[iBal] ?? "") : null;
    const ref = (iRef >= 0 && r[iRef] && !/^0+$/.test(r[iRef]!) ? r[iRef] : undefined) || extractRef(desc);
    const time = iTime >= 0 && /^\d{1,2}:\d{2}/.test(r[iTime] ?? "") ? r[iTime]!.slice(0, 5) : /\b(\d{2}:\d{2})(?::\d{2})?\b/.exec(r[iDate] ?? "")?.[1];
    rows.push({ line: n + 1, date: d.date, description: desc, direction, amountPaise: amount, ...(ref ? { ref } : {}), ...(bal !== null ? { balancePaise: bal } : {}), ...(time ? { time } : {}) });
  }
  settleDirections(rows, opening);
  return finish(rows, opening, closing, grid.slice(0, hi).map((r) => r.join(" ")).join("\n"), warnings);
}

// ---------------- Text (from PDF) ----------------

/**
 * Line-based parser for text extracted from PDFs: a row starts with a date and ends with 1–3 amounts
 * (amount, balance; or debit, credit, balance). Lines without a date continue the previous narration.
 */
export function parseStatementText(text: string): ParsedStatement {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  let opening: number | undefined, closing: number | undefined;
  let headerSeen = false;
  let lastIdx = -10;
  lines.forEach((l, idx) => {
    if (!l) return;
    if (OPENING.test(l)) { opening = lastAmount(l) ?? opening; return; }
    if (CLOSING.test(l)) { closing = lastAmount(l) ?? closing; return; }
    if (/date/i.test(l) && /(narration|description|particulars|details)/i.test(l)) { headerSeen = true; return; }
    const d = parseDate(l);
    if (!d) {
      const prev = rows[rows.length - 1];
      if (prev && headerSeen && !SUMMARY.test(l) && lastIdx === idx - 1) { prev.description += ` ${l}`; lastIdx = idx; }
      return;
    }
    let rest = l.slice(d.len).trim();
    const timeM = /^(\d{1,2}:\d{2})(?::\d{2})?\s+/.exec(rest);
    if (timeM) rest = rest.slice(timeM[0].length);
    const second = parseDate(rest); // value date column
    if (second) rest = rest.slice(second.len).trim();
    const toks = rest.split(" ");
    const amounts: { v: number; raw: string }[] = [];
    while (toks.length && amounts.length < 3) {
      let tok = toks[toks.length - 1]!;
      if (/^(dr|cr)\.?$/i.test(tok) && toks.length > 1) { tok = `${toks[toks.length - 2]} ${tok}`; toks.pop(); }
      const v = parseAmount(tok);
      if (v === null || !/[.,]|dr|cr/i.test(tok)) { if (tok.includes(" ")) toks.push(tok.split(" ")[1]!); break; }
      amounts.unshift({ v, raw: tok });
      toks.pop();
    }
    if (!amounts.length) { if (!SUMMARY.test(l)) warnings.push(`Line ${idx + 1} has a date but no amount; skipped.`); return; }
    const desc = toks.join(" ").trim();
    if (SUMMARY.test(desc) && !desc.match(RAILS)) return;
    let amount: { v: number; raw: string }, bal: number | undefined, direction: Direction = "unknown";
    if (amounts.length === 3) { // debit credit balance with a zero in one column
      const [a, b, c] = amounts as [typeof amounts[0], typeof amounts[0], typeof amounts[0]];
      bal = c.v;
      if (a.v !== 0 && b.v === 0) { amount = a; direction = "debit"; } else if (b.v !== 0 && a.v === 0) { amount = b; direction = "credit"; } else { amount = a; warnings.push(`Line ${idx + 1}: unclear debit/credit columns.`); }
    } else if (amounts.length === 2) { amount = amounts[0]!; bal = amounts[1]!.v; }
    else amount = amounts[0]!;
    if (direction === "unknown") direction = /dr\.?$/i.test(amount.raw) ? "debit" : /cr\.?$/i.test(amount.raw) ? "credit" : amount.v < 0 ? "debit" : "unknown";
    if (amount.v === 0) return;
    const ref = extractRef(desc);
    lastIdx = idx;
    rows.push({ line: idx + 1, date: d.date, description: desc, direction, amountPaise: Math.abs(amount.v), ...(ref ? { ref } : {}), ...(bal !== undefined ? { balancePaise: bal } : {}), ...(timeM ? { time: timeM[1]!.padStart(5, "0") } : {}) });
  });
  settleDirections(rows, opening);
  return finish(rows, opening, closing, text.slice(0, 2000), warnings);
}

/** Replaces long digit runs (account / card / phone numbers) so they never reach an AI provider. */
export function maskForAi(s: string): string {
  return s.replace(/\d{6,}/g, (m) => `#${m.slice(-2)}`).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").slice(0, 160);
}
