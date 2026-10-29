/**
 * Live OpenRouter smoke test with FICTIONAL Indian bank lines. Never prints the key, prompts or raw responses.
 * Run: npm run ai:smoke   (needs OPENROUTER_API_KEY in server/.env or the environment)
 */
import "dotenv/config";
import { categorizeWithAi, type CategorizeInput } from "../src/ai/categorize.js";
import { OpenRouterClient, AiError, type Usage } from "../src/ai/openrouter.js";
import { maskForAi } from "../src/statements/parse.js";
import { DEFAULT_CATEGORIES } from "../src/statements/routes.js";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) { console.error("OPENROUTER_API_KEY is not set."); process.exit(2); }

const fast = process.env.AI_MODEL_FAST || "openai/gpt-4.1-mini";
const strong = process.env.AI_MODEL_STRONG || "openai/gpt-5-mini";

// Fictional lines with expected type (and acceptable categories).
const cases: { d: string; dir: "debit" | "credit"; type: string[]; cat?: string[] }[] = [
  { d: "UPI/412345678901/SWIGGY BANGALORE/swiggy@icici", dir: "debit", type: ["expense"], cat: ["Food & Dining", "Food", "Dining"] },
  { d: "NEFT CR-ACME DESIGNS PVT LTD-INV 1042 SCALE FLOW", dir: "credit", type: ["income"] },
  { d: "ACH D- HDFC BANK LTD EMI LOAN 88231", dir: "debit", type: ["loan_repayment"] },
  { d: "CC PAYMENT BILLDESK ICICI CREDIT CARD XX4421", dir: "debit", type: ["cc_payment"] },
  { d: "IMPS/P2A/OWN ACCOUNT TRANSFER TO SBI SAVINGS", dir: "debit", type: ["transfer"] },
  { d: "UPI/AMAZON PAY REFUND ORDER 403-1234567", dir: "credit", type: ["refund"] },
  { d: "SALARY CREDIT FEB TECHNOVA SOLUTIONS", dir: "credit", type: ["income"], cat: ["Salary", "Income"] },
  { d: "POS 4521XXXX INDIAN OIL PETROL PUMP PUNE", dir: "debit", type: ["expense"], cat: ["Fuel", "Transport", "Travel", "Transportation"] },
  { d: "BBPS/AIRTEL POSTPAID MOBILE BILL", dir: "debit", type: ["expense"], cat: ["Bills & Utilities", "Utilities", "Bills"] },
  { d: "UPI/ZERODHA BROKING SIP MUTUAL FUND", dir: "debit", type: ["expense", "transfer"], cat: ["Investments", "Investment"] },
  { d: "PERSONAL LOAN DISBURSAL BAJAJ FINANCE", dir: "credit", type: ["loan_disbursement"] },
  { d: "UPI/AWS INDIA CLOUD HOSTING SCALE FLOW", dir: "debit", type: ["expense"] },
];

const usages: Usage[] = [];
const client = new OpenRouterClient(
  { apiKey: key, fastModel: fast, strongModel: strong, timeoutMs: 60_000, maxRetries: 1, maxCostPerStatementUsd: 0.05, dailyCostLimitUsd: 0.2 },
  undefined,
  { usage: (u) => usages.push(u), error: (m, meta) => console.warn("[ai]", m, meta) },
);

async function main() {
  // 1) Privacy routing check: a ZDR + deny request per model must succeed (or fail closed).
  for (const model of [fast, strong]) {
    const lines: CategorizeInput[] = [{ i: 0, d: maskForAi(cases[0].d), dir: "debit" }];
    try {
      const t = Date.now();
      await client.json({ model, system: "Classify.", user: JSON.stringify(lines), schemaName: "ping",
        jsonSchema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
        validate: (await import("zod")).z.object({ ok: z_bool() }), maxTokens: 400 }, { spentUsd: 0 });
      console.log(`privacy+strict-json ${model}: OK (${Date.now() - t} ms)`);
    } catch (e) {
      console.log(`privacy+strict-json ${model}: FAILED ${(e as AiError).code}: ${(e as Error).message}`);
    }
  }

  // 2) Real classification.
  const input = cases.map((c, i) => ({ i, d: maskForAi(c.d), dir: c.dir }));
  const t0 = Date.now();
  const res = await categorizeWithAi(client, input, DEFAULT_CATEGORIES, ["Scale Flow"]);
  const ms = Date.now() - t0;
  let typeOk = 0, catOk = 0, catN = 0;
  for (const [i, c] of cases.entries()) {
    const s = res.items.find((x) => x.i === i);
    const tOk = !!s && c.type.includes(s.type);
    if (tOk) typeOk++;
    let cOk: boolean | null = null;
    if (c.cat) { catN++; cOk = !!s && c.cat.includes(s.category); if (cOk) catOk++; }
    console.log(`${tOk ? "✓" : "✗"} #${i} type=${s?.type ?? "-"} (want ${c.type.join("/")}) cat=${s?.category ?? "-"}${cOk === false ? " (cat miss)" : ""} conf=${s?.confidence ?? "-"} scope=${s?.scope ?? "-"}`);
  }
  console.log(`\nreturned ${res.items.length}/${cases.length} rows, calls=${res.calls}, total ${ms} ms`);
  console.log(`type accuracy ${typeOk}/${cases.length}, category accuracy ${catOk}/${catN}`);
  for (const u of usages) console.log(`usage model=${u.model} in=${u.promptTokens} out=${u.completionTokens} cost=$${u.costUsd.toFixed(6)} ms=${u.ms}`);
  console.log(`total cost $${usages.reduce((a, u) => a + u.costUsd, 0).toFixed(6)}`);
}
function z_bool() { return (globalThis as any).__z.boolean(); }

import("zod").then(({ z }) => { (globalThis as any).__z = z; return main(); }).catch((e) => {
  console.error("FAILED:", e instanceof AiError ? `${e.code}: ${e.message}` : (e as Error).message);
  process.exit(1);
});
