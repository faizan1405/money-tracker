/**
 * AI service architecture (OpenRouter, later phase). Not wired up yet: the routes return 501.
 * The API key will be read from OPENROUTER_API_KEY on the server only — never sent to the browser.
 */
export interface ExtractedTxn { date: string; description: string; amountPaise: number; direction: "debit" | "credit"; ref?: string; balancePaise?: number }

export interface StatementExtractor { extract(file: Buffer, mime: string): Promise<ExtractedTxn[]> }
export interface Categorizer { categorize(t: ExtractedTxn, ctx: { rules: { match: string; category: string }[]; history: string[] }): Promise<{ category: string; merchant: string; confidence: number; reason: string }> }
export interface FinanceChat { reply(messages: { role: "user" | "assistant"; content: string }[], facts: Record<string, unknown>): Promise<string> }
export interface InsightEngine { insights(summary: Record<string, unknown>): Promise<string[]> }

/**
 * Rule of the design: amounts and totals are ALWAYS computed by domain/ledger.ts from stored data.
 * The model only extracts text and suggests categories; it never invents numbers shown to the user.
 * Duplicate detection stays deterministic (domain/ledger.ts → matchDuplicate), not AI-based.
 */
export class AiNotConfiguredError extends Error {
  constructor() { super("AI features are not configured on this server yet"); }
}
