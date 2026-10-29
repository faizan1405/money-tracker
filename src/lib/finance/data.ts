import type { Account, Budget, Due, Goal, Project, Recurring, Rule, Transaction, Workspace, WorkspaceId } from "./types";

export const WORKSPACES: Workspace[] = [
  { id: "personal", name: "Personal", short: "Personal", kind: "personal" },
  { id: "scaleflow", name: "Business: Scale Flow", short: "Scale Flow", kind: "business" },
];

export const PERSONAL_CATEGORIES = ["Food & Dining", "Groceries", "Shopping", "Transport", "Bills & Utilities", "Rent", "Health", "Education", "Entertainment", "Subscriptions", "Other"];
export const BUSINESS_CATEGORIES = ["Meta Ads", "Hosting & Domains", "Software & Tools", "Freelancer Payments", "Salaries", "Marketing", "Client Project Costs", "Office Expenses", "Other Business Expenses"];
export const INCOME_CATEGORIES = ["Client Payment", "Salary", "Freelance", "Business Revenue", "Interest", "Other Income"];
export const SYSTEM_CATEGORIES = ["Transfer", "Card Payment", "Loan", "Adjustment", "Refund"];

export const ACCOUNTS: Account[] = [
  { id: "hdfc", name: "HDFC Savings", institution: "HDFC Bank", kind: "bank", workspace: "personal", openingBalance: 142000, last4: "4821", reconciled: "reconciled" },
  { id: "gpay", name: "GPay UPI (HDFC)", institution: "Google Pay", kind: "upi", workspace: "personal", openingBalance: 0, reconciled: "never" },
  { id: "cash", name: "Cash Wallet", institution: "Cash", kind: "cash", workspace: "personal", openingBalance: 6500, reconciled: "never" },
  { id: "icici-cc", name: "ICICI Amazon Pay Card", institution: "ICICI Bank", kind: "credit_card", workspace: "personal", openingBalance: -8400, last4: "7719", creditLimit: 150000, reconciled: "pending" },
  { id: "kotak-biz", name: "Kotak Current — Scale Flow", institution: "Kotak Mahindra", kind: "bank", workspace: "scaleflow", openingBalance: 88000, last4: "0932", reconciled: "pending" },
  { id: "paytm", name: "Paytm Wallet", institution: "Paytm", kind: "wallet", workspace: "personal", openingBalance: 1200, reconciled: "never" },
];

export const PROJECTS: Project[] = [
  { id: "p1", client: "Sharma Interiors", name: "Website Redesign", value: 60000, invoiced: 60000 },
  { id: "p2", client: "GreenLeaf Organics", name: "Shopify Store", value: 45000, invoiced: 30000 },
  { id: "p3", client: "Patel Dental Clinic", name: "Landing Page + Ads", value: 28000, invoiced: 28000 },
  { id: "p4", client: "UrbanFit Gym", name: "Booking Web App", value: 85000, invoiced: 40000 },
];

// deterministic pseudo-random
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

let n = 0;
const pj = (i: number) => PROJECTS[i % PROJECTS.length]!;
const pick = (a: string[], r: () => number) => a[Math.floor(r() * a.length)]!;
const id = () => `t${++n}`;

function at(now: Date, monthsAgo: number, day: number, hour = 12): string {
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, hour, Math.floor((day * 7) % 60));
  return d.toISOString();
}

type Seed = Omit<Transaction, "id" | "status" | "source"> & { status?: Transaction["status"] };

export function buildDemoTransactions(now = new Date()): Transaction[] {
  n = 0;
  const r = rng(42);
  const out: Seed[] = [];
  const today = now.getDate();

  for (let m = 5; m >= 0; m--) {
    const maxDay = m === 0 ? today : 28;
    const ok = (d: number) => d <= maxDay;
    const P = (day: number, s: Omit<Seed, "date" | "workspace">, ws: WorkspaceId = "personal", hour = 12) => {
      if (ok(day)) out.push({ ...s, date: at(now, m, day, hour), workspace: ws });
    };

    // Salary / income
    P(1, { type: "income", amount: 72000, description: "NEFT-SAL-ACME TECHNOLOGIES PVT LTD", merchant: "Acme Technologies", category: "Salary", accountId: "hdfc", recurring: true }, "personal", 10);
    P(2, { type: "expense", amount: 18000, description: "IMPS-RENT-MR K RAO", merchant: "K. Rao (Landlord)", category: "Rent", accountId: "hdfc", recurring: true });
    P(5, { type: "expense", amount: 1999, description: "HOSTINGER INTERNATIONAL", merchant: "Hostinger", category: "Hosting & Domains", accountId: "kotak-biz", recurring: m % 3 === 0 }, "scaleflow");
    P(5, { type: "loan_repayment", amount: 9450, interest: 2310, description: "EMI HDFC PERSONAL LOAN", merchant: "HDFC Bank Loans", category: "Loan", accountId: "hdfc", recurring: true });
    P(7, { type: "expense", amount: 649, description: "NETFLIX.COM MUMBAI", merchant: "Netflix", category: "Subscriptions", accountId: "icici-cc", recurring: true });
    P(7, { type: "expense", amount: 119, description: "SPOTIFY INDIA", merchant: "Spotify", category: "Subscriptions", accountId: "icici-cc", recurring: true });
    P(8, { type: "expense", amount: 1680, description: "CANVA PRO + FIGMA", merchant: "Canva", category: "Software & Tools", accountId: "kotak-biz", recurring: true }, "scaleflow");
    P(10, { type: "expense", amount: 1850 + Math.round(r() * 900), description: "BESCOM ELECTRICITY BILL", merchant: "BESCOM", category: "Bills & Utilities", accountId: "gpay" });
    P(11, { type: "expense", amount: 799, description: "AIRTEL FIBER", merchant: "Airtel", category: "Bills & Utilities", accountId: "gpay", recurring: true });
    P(12, { type: "income", amount: 20000 + (m % 2) * 15000, description: `UPI-SCALE FLOW-${pj(m).client.toUpperCase()}`, merchant: pj(m).client, category: "Client Payment", accountId: "kotak-biz", client: pj(m).client, project: pj(m).name }, "scaleflow");
    P(14, { type: "expense", amount: 3500 + Math.round(r() * 2500), description: "FACEBK *META ADS", merchant: "Meta Ads", category: "Meta Ads", accountId: "kotak-biz" }, "scaleflow");
    P(15, { type: "transfer", amount: 10000, description: "Owner draw: Scale Flow → HDFC", merchant: "Self transfer", category: "Transfer", accountId: "kotak-biz", toAccountId: "hdfc" }, "scaleflow");
    P(16, { type: "expense", amount: 6000, description: "UPI-FREELANCER-RAHUL DESIGNS", merchant: "Rahul Designs", category: "Freelancer Payments", accountId: "kotak-biz", project: pj(m).name, client: pj(m).client }, "scaleflow");
    P(18, { type: "cc_payment", amount: 7000 + Math.round(r() * 3000), description: "ICICI CARD BILL PAYMENT", merchant: "ICICI Credit Card", category: "Card Payment", accountId: "hdfc", toAccountId: "icici-cc" });
    P(20, { type: "transfer", amount: 3000, description: "ATM WDL HDFC KORAMANGALA", merchant: "ATM Withdrawal", category: "Transfer", accountId: "hdfc", toAccountId: "cash" });
    P(22, { type: "income", amount: 15000 + Math.round(r() * 10000), description: "UPI-SCALE FLOW-MILESTONE", merchant: pj(m + 1).client, category: "Client Payment", accountId: "kotak-biz", client: pj(m + 1).client, project: pj(m + 1).name }, "scaleflow");
    P(24, { type: "expense", amount: 2400 + Math.round(r() * 2000), description: "GOOGLE ADS INDIA", merchant: "Google Ads", category: "Marketing", accountId: "kotak-biz" }, "scaleflow");
    P(26, { type: "income", amount: 380, description: "SB INTEREST CREDIT", merchant: "HDFC Bank", category: "Interest", accountId: "hdfc" });

    // Variable daily spending
    const food = ["SWIGGY", "ZOMATO", "Third Wave Coffee", "Meghana Foods", "Chai Point"];
    const groceries = ["BIGBASKET", "Zepto", "Blinkit", "DMart"];
    const shop = ["AMAZON IN", "MYNTRA", "Decathlon", "Croma"];
    const trans = ["UBER INDIA", "OLA", "Rapido", "IOCL Petrol"];
    for (let d = 1; d <= 28; d += 2) {
      const h = 9 + Math.floor(r() * 12);
      P(d, { type: "expense", amount: Math.round(180 + r() * 520), description: `UPI-${pick(food, r)}`, merchant: pick(food, r), category: "Food & Dining", accountId: r() > 0.3 ? "gpay" : "cash" }, "personal", h);
      if (d % 6 === 1) P(d, { type: "expense", amount: Math.round(900 + r() * 1400), description: `UPI-${pick(groceries, r)}`, merchant: pick(groceries, r), category: "Groceries", accountId: "gpay" }, "personal", h);
      if (d % 4 === 3) P(d, { type: "expense", amount: Math.round(120 + r() * 380), description: `UPI-${pick(trans, r)}`, merchant: pick(trans, r), category: "Transport", accountId: "gpay" }, "personal", h);
      if (d % 9 === 0) P(d, { type: "expense", amount: Math.round(800 + r() * 3500), description: pick(shop, r), merchant: pick(shop, r), category: "Shopping", accountId: "icici-cc" }, "personal", h);
    }
    P(19, { type: "expense", amount: 650 + Math.round(r() * 1200), description: "APOLLO PHARMACY", merchant: "Apollo Pharmacy", category: "Health", accountId: "gpay" });
    P(21, { type: "expense", amount: 900 + Math.round(r() * 800), description: "PVR CINEMAS / BOOKMYSHOW", merchant: "BookMyShow", category: "Entertainment", accountId: "icici-cc" });
  }
  // Special
  out.push({ type: "refund", amount: 1299, description: "AMAZON REFUND", merchant: "AMAZON IN", category: "Shopping", accountId: "icici-cc", workspace: "personal", date: at(now, 0, Math.max(1, today - 1), 15) });
  out.push({ type: "loan_disbursement", amount: 25000, description: "Borrowed from Arjun (friend)", merchant: "Arjun Mehta", category: "Loan", accountId: "hdfc", workspace: "personal", date: at(now, 2, 9, 18) });
  out.push({ type: "expense", amount: 4999, description: "UDEMY / COURSERA COURSE", merchant: "Coursera", category: "Education", accountId: "icici-cc", workspace: "personal", date: at(now, 1, 13) });
  out.push({ type: "expense", amount: 11800, description: "MACBOOK CHARGER + DESK SETUP", merchant: "Croma", category: "Office Expenses", accountId: "kotak-biz", workspace: "scaleflow", date: at(now, 0, Math.max(1, today - 3), 14), status: "pending" });

  return out
    .map((s) => ({ ...s, id: id(), status: s.status ?? "cleared", source: "demo" as const }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function addDays(now: Date, d: number) {
  const x = new Date(now);
  x.setDate(x.getDate() + d);
  return x.toISOString();
}

export function buildDues(now = new Date()): Due[] {
  return [
    { id: "d1", direction: "i_owe", kind: "loan", party: "HDFC Bank — Personal Loan", principal: 300000, outstanding: 186400, dueDate: addDays(now, 6), interestRate: 11.5, emi: 9450, workspace: "personal", payments: [{ date: addDays(now, -24), amount: 9450, interest: 2310 }, { date: addDays(now, -55), amount: 9450, interest: 2360 }] },
    { id: "d2", direction: "i_owe", kind: "personal", party: "Arjun Mehta", principal: 25000, outstanding: 15000, dueDate: addDays(now, 20), workspace: "personal", notes: "Borrowed for bike service + deposit", payments: [{ date: addDays(now, -15), amount: 10000 }] },
    { id: "d3", direction: "i_owe", kind: "emi", party: "Bajaj Finserv — iPhone EMI", principal: 72000, outstanding: 24000, dueDate: addDays(now, -2), emi: 6000, workspace: "personal", payments: [] },
    { id: "d4", direction: "owed_to_me", kind: "client", party: "GreenLeaf Organics", principal: 45000, outstanding: 15000, dueDate: addDays(now, -5), workspace: "scaleflow", notes: "Final milestone — Shopify Store", payments: [{ date: addDays(now, -30), amount: 30000 }] },
    { id: "d5", direction: "owed_to_me", kind: "client", party: "UrbanFit Gym", principal: 85000, outstanding: 45000, dueDate: addDays(now, 12), workspace: "scaleflow", payments: [{ date: addDays(now, -40), amount: 40000 }] },
    { id: "d6", direction: "owed_to_me", kind: "personal", party: "Neha (college friend)", principal: 8000, outstanding: 5000, dueDate: addDays(now, 3), workspace: "personal", payments: [{ date: addDays(now, -10), amount: 3000 }] },
  ];
}

export const BUDGETS: Budget[] = [
  { id: "b1", category: "Food & Dining", workspace: "personal", limit: 6000 },
  { id: "b2", category: "Groceries", workspace: "personal", limit: 6000 },
  { id: "b3", category: "Shopping", workspace: "personal", limit: 5000 },
  { id: "b4", category: "Transport", workspace: "personal", limit: 2500 },
  { id: "b5", category: "Meta Ads", workspace: "scaleflow", limit: 6000 },
  { id: "b6", category: "Software & Tools", workspace: "scaleflow", limit: 3000 },
];

export const GOALS: Goal[] = [
  { id: "g1", name: "Emergency fund", target: 300000, saved: 182000, deadline: "2027-03-31" },
  { id: "g2", name: "Goa trip", target: 40000, saved: 14500, deadline: "2026-12-20" },
  { id: "g3", name: "New laptop for Scale Flow", target: 120000, saved: 52000, deadline: "2027-01-31" },
];

export function buildRecurring(now = new Date()): Recurring[] {
  return [
    { id: "r1", name: "Rent", amount: 18000, category: "Rent", workspace: "personal", nextDate: addDays(now, 4), cadence: "monthly" },
    { id: "r2", name: "Netflix", amount: 649, category: "Subscriptions", workspace: "personal", nextDate: addDays(now, 8), cadence: "monthly" },
    { id: "r3", name: "Hostinger Business", amount: 1999, category: "Hosting & Domains", workspace: "scaleflow", nextDate: addDays(now, 7), cadence: "quarterly" },
    { id: "r4", name: "Canva + Figma", amount: 1680, category: "Software & Tools", workspace: "scaleflow", nextDate: addDays(now, 10), cadence: "monthly" },
    { id: "r5", name: "Airtel Fiber", amount: 799, category: "Bills & Utilities", workspace: "personal", nextDate: addDays(now, 13), cadence: "monthly" },
    { id: "r6", name: "Domain renewals", amount: 2400, category: "Hosting & Domains", workspace: "scaleflow", nextDate: addDays(now, 45), cadence: "yearly" },
  ];
}

export const RULES: Rule[] = [
  { id: "ru1", match: "HOSTINGER", category: "Hosting & Domains", workspace: "scaleflow", priority: 1, enabled: true },
  { id: "ru2", match: "FACEBK", category: "Meta Ads", workspace: "scaleflow", priority: 2, enabled: true },
  { id: "ru3", match: "SWIGGY", category: "Food & Dining", workspace: "personal", priority: 3, enabled: true },
  { id: "ru4", match: "BIGBASKET", category: "Groceries", workspace: "personal", priority: 4, enabled: true },
  { id: "ru5", match: "UBER", category: "Transport", workspace: "personal", priority: 5, enabled: false },
];

export interface StatementRow {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  category: string;
  workspace: WorkspaceId;
  confidence: number;
  duplicateOf?: string;
  flag?: string;
  state: "pending" | "approved" | "rejected";
}

export function buildSampleStatement(now = new Date()): StatementRow[] {
  const d = (k: number) => addDays(now, -k);
  const rows: Omit<StatementRow, "id" | "state">[] = [
    { date: d(1), merchant: "Swiggy", description: "UPI/412233/SWIGGY/BLR", amount: 486, direction: "debit", category: "Food & Dining", workspace: "personal", confidence: 0.97 },
    { date: d(2), merchant: "Hostinger", description: "POS HOSTINGER INTL", amount: 1999, direction: "debit", category: "Hosting & Domains", workspace: "scaleflow", confidence: 0.99, flag: "Matched rule: HOSTINGER" },
    { date: d(2), merchant: "Hostinger", description: "POS HOSTINGER INTL", amount: 1999, direction: "debit", category: "Hosting & Domains", workspace: "scaleflow", confidence: 0.99, duplicateOf: "Possible duplicate of row above" },
    { date: d(3), merchant: "Sharma Interiors", description: "NEFT CR SHARMA INTERIORS", amount: 20000, direction: "credit", category: "Client Payment", workspace: "scaleflow", confidence: 0.91 },
    { date: d(4), merchant: "Self transfer", description: "IMPS TO KOTAK XX0932", amount: 15000, direction: "debit", category: "Transfer", workspace: "personal", confidence: 0.88, flag: "Looks like a transfer between your own accounts" },
    { date: d(5), merchant: "DMart", description: "UPI/DMART AVENUE", amount: 1250, direction: "debit", category: "Groceries", workspace: "personal", confidence: 0.94 },
    { date: d(6), merchant: "Amazon", description: "REFUND AMAZON SELLER", amount: 799, direction: "credit", category: "Refund", workspace: "personal", confidence: 0.82 },
    { date: d(7), merchant: "Unknown", description: "UPI/9876543210@ybl", amount: 2300, direction: "debit", category: "Other", workspace: "personal", confidence: 0.34, flag: "Unknown recipient — needs your input" },
    { date: d(8), merchant: "Meta Ads", description: "FACEBK *ADS 7HZK", amount: 3500, direction: "debit", category: "Meta Ads", workspace: "scaleflow", confidence: 0.98 },
    { date: d(9), merchant: "Zomato", description: "UPI/ZOMATO LTD", amount: 420, direction: "debit", category: "Food & Dining", workspace: "personal", confidence: 0.96 },
    { date: d(10), merchant: "Croma", description: "POS CROMA RETAIL", amount: 14990, direction: "debit", category: "Shopping", workspace: "personal", confidence: 0.71, flag: "Unusually large for Shopping" },
  ];
  return rows.map((x, i) => ({ ...x, id: `s${i}`, state: "pending" }));
}
