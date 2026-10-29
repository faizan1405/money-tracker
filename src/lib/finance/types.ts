export type WorkspaceId = "personal" | "scaleflow";
export type WorkspaceFilter = WorkspaceId | "all";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  short: string;
  kind: "personal" | "business";
}

export type TxnType =
  | "income"
  | "expense"
  | "transfer"
  | "refund"
  | "loan_disbursement"
  | "loan_repayment"
  | "cc_payment"
  | "adjustment";

export type AccountKind = "bank" | "cash" | "upi" | "credit_card" | "wallet";

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  workspace: WorkspaceId;
  openingBalance: number; // for credit cards: negative = amount owed
  last4?: string | undefined;
  creditLimit?: number | undefined;
  reconciled: "reconciled" | "pending" | "never";
}

export interface Transaction {
  id: string;
  date: string; // ISO
  type: TxnType;
  amount: number; // always positive; for adjustment, sign stored in adjustmentSign
  adjustmentSign?: 1 | -1 | undefined;
  description: string;
  merchant: string;
  category: string;
  subcategory?: string | undefined;
  workspace: WorkspaceId;
  accountId: string;
  toAccountId?: string | undefined; // transfers & cc payments
  interest?: number | undefined; // loan_repayment: part of amount that is interest (an expense)
  client?: string | undefined;
  project?: string | undefined;
  notes?: string | undefined;
  status: "cleared" | "pending";
  recurring?: boolean | undefined;
  source?: "manual" | "statement" | "demo" | undefined;
}

export interface Due {
  id: string;
  direction: "i_owe" | "owed_to_me";
  kind: "loan" | "personal" | "client" | "emi";
  party: string;
  principal: number;
  outstanding: number;
  dueDate: string;
  interestRate?: number | undefined;
  emi?: number | undefined;
  workspace: WorkspaceId;
  notes?: string | undefined;
  payments: { date: string; amount: number; interest?: number }[];
}

export interface Budget {
  id: string;
  category: string;
  workspace: WorkspaceId;
  limit: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string;
}

export interface Recurring {
  id: string;
  name: string;
  amount: number;
  category: string;
  workspace: WorkspaceId;
  nextDate: string;
  cadence: "monthly" | "yearly" | "quarterly";
}

export interface Project {
  id: string;
  client: string;
  name: string;
  value: number;
  invoiced: number;
}

export interface Rule {
  id: string;
  match: string;
  category: string;
  workspace: WorkspaceId;
  priority: number;
  enabled: boolean;
}

export type Draft<T> = { [K in keyof T]?: T[K] | undefined };

export type Period = "week" | "month" | "last_month" | "year" | "custom";
