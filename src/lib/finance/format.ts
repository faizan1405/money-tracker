const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function formatINR(n: number) {
  return inr.format(Math.round(n));
}

export function formatCompact(n: number) {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${inrCompact.format(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}₹${inrCompact.format(a / 1e5)}L`;
  if (a >= 1e3) return `${s}₹${inrCompact.format(a / 1e3)}k`;
  return `${s}₹${Math.round(a)}`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

export function formatDateTime(iso: string) {
  // Date-only values (stored by the server as a calendar day) have no real time — don't invent one.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate(iso, { day: "2-digit", month: "short" });
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pctChange(curr: number, prev: number) {
  if (!prev) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
