import type { DupMatch } from "../domain/ledger.js";
import type { Direction } from "./parse.js";

/** One extracted statement line awaiting the owner's decision. Money in integer paise. Never part of the ledger until approved. */
export interface ReviewRow {
  id: string;
  line: number;
  date: string;
  time?: string;
  description: string;
  direction: Direction;
  amountPaise: number;
  ref?: string;
  balancePaise?: number;
  suggestion: { type: string; category: string; subcategory: string; merchant: string; workspace: string };
  confidence: number;
  source: "rule" | "ai" | "none";
  reason: string;
  flags: string[];
  duplicate: DupMatch;
  matchedTransactionId?: string;
}

export interface Reconciliation {
  status: "balanced" | "mismatch" | "unclear" | "unavailable";
  openingPaise?: number;
  closingPaise?: number;
  creditsPaise: number;
  debitsPaise: number;
  differencePaise?: number;
  brokenRows: number[];
}

export interface ImportSummary {
  found: number;
  duplicates: number;
  flagged: number;
  period?: { from: string; to: string };
  accountLast4?: string;
  accountMatches?: boolean;
  reconciliation: Reconciliation;
  ai: { status: "used" | "not_configured" | "failed" | "not_needed"; message?: string; model?: string; costUsd?: number; calls?: number };
  warnings: string[];
  sameFileImportedBefore?: boolean;
  created?: number;
  skipped?: number;
}

export type ImportStatus = "uploaded" | "processing" | "needs_review" | "completed" | "failed";

export interface ImportRec {
  id: string;
  accountId: string;
  workspace: string;
  fileName: string;
  fileHash: string;
  status: ImportStatus;
  error?: string | null;
  createdAt: string;
  summary?: ImportSummary | null;
  rows?: ReviewRow[] | null;
}
