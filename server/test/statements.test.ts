import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { OpenRouterClient } from "../src/ai/openrouter.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { MemoryRepo } from "../src/repo/memory.js";
import { maskForAi, parseAmount, parseCsv, parseDate, parseStatementText } from "../src/statements/parse.js";
import { pdfToText } from "../src/statements/pdf.js";
import { CARD_CSV, HDFC_CSV, SBI_PDF_PAGES, fakeOpenRouter, makePdf, type FakeAi } from "./fixtures.js";
import { ORIGIN, PASSWORD, config, cookieToken, makeRepo, onPrisma, setup, tx } from "./helpers.js";

const aiCfg = { apiKey: "test-key", fastModel: "openai/gpt-4.1-mini", strongModel: "openai/gpt-5-mini", timeoutMs: 200, maxRetries: 1, maxCostPerStatementUsd: 0.05, dailyCostLimitUsd: 1 };

describe("deterministic parsing", () => {
  it("parses Indian dates and exact paise amounts", () => {
    expect(parseDate("05/10/26")?.date).toBe("2026-10-05");
    expect(parseDate("05 Oct 2026")?.date).toBe("2026-10-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseAmount("1,23,456.78")).toBe(12345678);
    expect(parseAmount("0.10")).toBe(10);
    expect(parseAmount("500.00 Dr")).toBe(-50000);
    expect(parseAmount("(20.5)")).toBe(-2050);
    expect(parseAmount("12.345")).toBeNull();
  });

  it("CSV: debit/credit columns, opening/closing, refs, multi-line, account last 4", () => {
    const p = parseCsv(HDFC_CSV);
    expect(p.rows).toHaveLength(11);
    expect(p.openingPaise).toBe(1_000_000);
    expect(p.closingPaise).toBe(4_961_100);
    expect(p.accountLast4).toBe("4321");
    expect(p.period).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(p.rows[1]).toMatchObject({ direction: "debit", amountPaise: 45050, ref: "627512345678" });
    expect(p.rows[8]!.ref).toBe("REV-627512345678"); // reversal keeps a distinct reference
    expect(p.rows[0]).toMatchObject({ direction: "credit", amountPaise: 8_500_000, ref: "NEFT0001" });
  });

  it("CSV: single amount column with Dr/Cr (credit card)", () => {
    const p = parseCsv(CARD_CSV);
    expect(p.rows.map((r) => [r.direction, r.amountPaise])).toEqual([["debit", 149900], ["debit", 89900], ["credit", 500000]]);
  });

  it("text PDF, multi-page, multi-line narration, direction from running balance", async () => {
    const { text, pages } = await pdfToText(makePdf(SBI_PDF_PAGES));
    expect(pages).toBe(2);
    const p = parseStatementText(text);
    expect(p.rows).toHaveLength(3);
    expect(p.rows.map((r) => r.direction)).toEqual(["credit", "debit", "debit"]);
    expect(p.rows[1]!.description).toContain("domain renewal");
    expect(p.rows[1]!.ref).toBe("627511112222");
    expect(p.openingPaise).toBe(500_000);
    expect(p.closingPaise).toBe(4_300_000);
    expect(p.accountLast4).toBe("9876");
  });

  it("rejects corrupt and scanned (text-less) PDFs with clear codes", async () => {
    await expect(pdfToText(Buffer.from("%PDF-1.4 garbage"))).rejects.toMatchObject({ code: "unreadable" });
    await expect(pdfToText(Buffer.from("hello"))).rejects.toMatchObject({ code: "unreadable" });
    await expect(pdfToText(makePdf([[]]))).rejects.toMatchObject({ code: "scanned" });
  });

  it("masks account/card/phone numbers before anything reaches AI", () => {
    expect(maskForAi("UPI-RAHUL-9876543210-627598765432 rahul@okaxis.com")).toBe("UPI-RAHUL-#10-#32 [email]");
  });
});

describe("statement import API", () => {
  let repo: MemoryRepo;
  let ai: FakeAi;
  let ctx: Awaited<ReturnType<typeof setup>>;
  const up = (app: typeof ctx.app, name: string, body: string | Buffer, accountId: string, extra: Record<string, string> = {}) => {
    let r = request(app).post("/api/statements").set(ctx.auth).field("accountId", accountId);
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach("file", Buffer.isBuffer(body) ? body : Buffer.from(body), name);
  };
  const appWith = (client: OpenRouterClient | null) => createApp({ repo, config, ai: client });

  beforeEach(async () => {
    repo = (await makeRepo()) as MemoryRepo; // MySQL when TEST_DATABASE_URL is set
    ai = fakeOpenRouter();
    ctx = await setup(repo);
    ctx.app = appWith(new OpenRouterClient(aiCfg, ai.fetch, { usage: () => {}, error: () => {} }, async () => {}));
  });

  it("uploads a CSV, categorises with AI using strict privacy settings, and flags what needs review", async () => {
    const r = await up(ctx.app, "hdfc.csv", HDFC_CSV, ctx.bank);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("needs_review");
    expect(r.body.summary).toMatchObject({ found: 11, reconciliation: { status: "balanced", opening: 10000, closing: 49611 }, ai: { status: "used" } });
    const sent = ai.calls[0]!.body as { provider: Record<string, unknown>; response_format: { type: string; json_schema: { strict: boolean } }; messages: { content: string }[] };
    expect(sent.provider).toMatchObject({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(sent.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    const payload = sent.messages[1]!.content;
    expect(payload).not.toContain("85,000"); // amounts are never sent
    expect(payload).not.toContain("627512345678"); // references / numbers masked
    expect(payload).not.toContain("4321");

    const rows = (await request(ctx.app).get(`/api/statements/${r.body.id}/review`).set(ctx.auth)).body as { description: string; amount: number; proposed: { type: string; category: string; workspace: string }; flags: string[]; duplicate: string }[];
    const by = (s: string) => rows.find((x) => x.description.includes(s))!;
    expect(by("SALARY").proposed).toMatchObject({ type: "income", category: "Salary" });
    expect(by("FACEBK").proposed).toMatchObject({ category: "Meta Ads", workspace: "scaleflow" }); // business spend on a personal account
    expect(by("FACEBK").flags.join()).toMatch(/different workspace/);
    expect(by("EMI").flags.join()).toMatch(/interest is not split/);
    expect(by("SELF").flags.join()).toMatch(/other account/);
    expect(by("REV-UPI").proposed.type).toBe("refund");
    // Injected instructions can't change the statement's facts: debit stays an expense, amount untouched.
    expect(by("IGNORE ALL").amount).toBe(99);
    expect(by("IGNORE ALL").proposed.type).toBe("expense");
    expect(by("IGNORE ALL").flags.join()).toMatch(/statement shows money out/);
    // Distinct refs on look-alike ₹20 payments → not duplicates.
    expect(rows.filter((x) => x.description.includes("CHAI")).map((x) => x.duplicate)).toEqual(["none", "none"]);
  });

  it("approve/reject saves only approved rows, atomically, and learns from corrections", async () => {
    const imp = (await up(ctx.app, "hdfc.csv", HDFC_CSV, ctx.bank)).body;
    const rows = (await request(ctx.app).get(`/api/statements/${imp.id}/review`).set(ctx.auth)).body as { id: string; description: string }[];
    const id = (s: string) => rows.find((x) => x.description.includes(s))!.id;
    const decide = (decisions: unknown[]) => request(ctx.app).post(`/api/statements/${imp.id}/review`).set(ctx.auth).send({ decisions });

    // Transfer without the other account is refused; nothing is saved.
    expect((await decide([{ id: id("SALARY"), decision: "accept" }, { id: id("SELF"), decision: "accept" }])).status).toBe(422);
    expect((await request(ctx.app).get("/api/transactions").set(ctx.auth)).body.total).toBe(0);

    const ok = await decide([
      { id: id("SALARY"), decision: "accept" },
      { id: id("SELF"), decision: "accept", edited: { otherAccountId: ctx.biz } },
      { id: id("CHAI POINT-chai@ybl-627500000001"), decision: "accept", edited: { category: "Snacks", merchant: "Chai Point" }, remember: true },
      { id: id("RAHUL"), decision: "skip" },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ created: 3, skipped: 1, rulesLearned: 1 });
    const list = (await request(ctx.app).get("/api/transactions").set(ctx.auth)).body.items as { type: string; accountId: string; toAccountId?: string; source: string; amount: number }[];
    expect(list).toHaveLength(3);
    expect(list.find((t) => t.type === "transfer")).toMatchObject({ accountId: ctx.bank, toAccountId: ctx.biz, amount: 20000 });
    expect(list.every((t) => t.source === "statement")).toBe(true);
    expect((await repo.getCollection(ctx.owner.id, "rules"))[0]).toMatchObject({ match: "Chai Point", category: "Snacks" });

    // Second approval of the same import is refused.
    expect((await decide([{ id: id("RAHUL"), decision: "accept" }])).status).toBe(409);

    // Re-import: same refs are "already imported" and can't be accepted; saved rule now applies without AI.
    ai.calls.length = 0;
    const again = await up(ctx.app, "hdfc.csv", HDFC_CSV, ctx.bank);
    expect(again.body.summary.sameFileImportedBefore).toBe(true);
    const rows2 = (await request(ctx.app).get(`/api/statements/${again.body.id}/review`).set(ctx.auth)).body as { id: string; description: string; duplicate: string; source: string; proposed: { category: string } }[];
    const sal = rows2.find((x) => x.description.includes("SALARY"))!;
    expect(sal.duplicate).toBe("exact");
    const chai = rows2.filter((x) => x.description.includes("CHAI"));
    expect(chai.map((x) => x.duplicate)).toEqual(["exact", "none"]);
    expect(chai.filter((x) => x.duplicate === "none").every((x) => x.source === "rule" && x.proposed.category === "Snacks")).toBe(true);
    const r = await request(ctx.app).post(`/api/statements/${again.body.id}/review`).set(ctx.auth).send({ decisions: [{ id: sal.id, decision: "accept" }] });
    expect(r.status).toBe(422);
  });

  it("legitimate repeat payments without references are flagged, not dropped, and can both be saved", async () => {
    const csv = `Date,Description,Debit,Credit,Balance\n05/10/2026,CASH PAID KIRANA,100.00,,900.00\n05/10/2026,CASH PAID KIRANA,100.00,,800.00\n`;
    const imp = (await up(ctx.app, "s.csv", csv, ctx.bank)).body;
    const rows = (await request(ctx.app).get(`/api/statements/${imp.id}/review`).set(ctx.auth)).body as { id: string; duplicate: string }[];
    expect(rows.map((r) => r.duplicate)).toEqual(["none", "possible"]);
    const r = await request(ctx.app).post(`/api/statements/${imp.id}/review`).set(ctx.auth).send({ decisions: rows.map((x) => ({ id: x.id, decision: "accept" })) });
    expect(r.body.created).toBe(2);
  });

  it("flags reconciliation mismatches and broken running balances", async () => {
    const bad = HDFC_CSV.replace('"94,549.50"', '"94,500.00"').replace(',Closing Balance,,,,,"49,611.00"', ',Closing Balance,,,,,"49,000.00"');
    const r = await up(ctx.app, "bad.csv", bad, ctx.bank);
    expect(r.body.summary.reconciliation.status).toBe("mismatch");
    expect(r.body.summary.reconciliation.difference).toBe(-611);
    expect(r.body.summary.warnings[0]).toMatch(/don't add up/);
    expect(r.body.summary.reconciliation.brokenRows.length).toBeGreaterThan(0);
  });

  it("text PDF upload end-to-end; mixed personal/business suggestions on a business account", async () => {
    const r = await up(ctx.app, "sbi.pdf", makePdf(SBI_PDF_PAGES), ctx.biz);
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ found: 3, reconciliation: { status: "balanced" }, period: { from: "2026-10-01", to: "2026-10-08" } });
  });

  it("refuses unsupported, corrupt and scanned files with clear messages and saves nothing", async () => {
    expect((await up(ctx.app, "photo.jpg", "x", ctx.bank)).status).toBe(415);
    const corrupt = await up(ctx.app, "x.pdf", "%PDF-1.4 nope", ctx.bank);
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.code).toBe("unreadable");
    expect((await up(ctx.app, "scan.pdf", makePdf([[]]), ctx.bank)).body.code).toBe("scanned");
    expect((await up(ctx.app, "x.csv", "hello,world\n1,2", ctx.bank)).body.code).toBe("unsupported");
    expect((await request(ctx.app).get("/api/statements").set(ctx.auth)).body).toEqual([]);
  });

  it("AI rate limit / timeout / privacy refusal / bad JSON → import still reviewable, AI marked failed", async () => {
    for (const [mode, msg] of [["429", /busy/], ["timeout", /too long/], ["no_zdr", /Privacy settings were not relaxed/], ["garbage", /malformed/]] as const) {
      ai.mode = mode;
      const r = await up(ctx.app, "card.csv", CARD_CSV, ctx.card);
      expect(r.status).toBe(201);
      expect(r.body.summary.ai.status).toBe("failed");
      expect(r.body.summary.ai.message).toMatch(msg);
    }
    expect(ai.calls.filter((c) => c.model).length).toBeGreaterThan(4); // retries happened
  });

  it("without an API key: rules still apply and the rest is marked for manual categorisation", async () => {
    const app = appWith(null);
    const r = await request(app).post("/api/statements").set(ctx.auth).field("accountId", ctx.card).attach("file", Buffer.from(CARD_CSV), "card.csv");
    expect(r.body.summary.ai.status).toBe("not_configured");
    expect(r.body.summary.flagged).toBe(3);
  });

  it("per-statement cost cap stops further AI calls", async () => {
    const client = new OpenRouterClient({ ...aiCfg, maxCostPerStatementUsd: 0.0001 }, ai.fetch, { usage: () => {}, error: () => {} }, async () => {});
    const app = appWith(client);
    const many = `Date,Description,Debit,Credit\n${Array.from({ length: 90 }, (_, i) => `01/10/2026,SHOP ${i},${i + 1}.00,`).join("\n")}\n`;
    const r = await request(app).post("/api/statements").set(ctx.auth).field("accountId", ctx.bank).attach("file", Buffer.from(many), "m.csv");
    expect(r.body.summary.ai).toMatchObject({ status: "failed" });
    expect(r.body.summary.ai.message).toMatch(/spending limit/);
    expect(ai.calls).toHaveLength(1);
  });

  it.skipIf(onPrisma)("database failure during approval rolls back: nothing saved, import still awaiting review", async () => {
    const imp = (await up(ctx.app, "card.csv", CARD_CSV, ctx.card)).body;
    const rows = (await request(ctx.app).get(`/api/statements/${imp.id}/review`).set(ctx.auth)).body as { id: string }[];
    repo.failNextComplete = true;
    const r = await request(ctx.app).post(`/api/statements/${imp.id}/review`).set(ctx.auth).send({ decisions: rows.map((x) => ({ id: x.id, decision: "accept" })) });
    expect(r.status).toBe(500);
    expect((await request(ctx.app).get("/api/transactions").set(ctx.auth)).body.total).toBe(0);
    expect((await request(ctx.app).get(`/api/statements/${imp.id}`).set(ctx.auth)).body.status).toBe("needs_review");
  });

  it("a reference clash at save time rolls back the whole approval", async () => {
    const imp = (await up(ctx.app, "hdfc.csv", HDFC_CSV, ctx.bank)).body;
    const rows = (await request(ctx.app).get(`/api/statements/${imp.id}/review`).set(ctx.auth)).body as { id: string; description: string }[];
    // Someone enters the salary manually (same bank ref) after the upload but before approval.
    expect((await request(ctx.app).post("/api/transactions").set(ctx.auth).send({ items: [tx({ type: "income", amount: 85000, accountId: ctx.bank, category: "Salary", ref: "NEFT0001" })] })).status).toBe(201);
    const pick = rows.filter((r) => /SALARY|SWIGGY-swiggy/.test(r.description));
    const r = await request(ctx.app).post(`/api/statements/${imp.id}/review`).set(ctx.auth).send({ decisions: pick.map((x) => ({ id: x.id, decision: "accept" })) });
    expect(r.status).toBe(409);
    expect((await request(ctx.app).get("/api/transactions").set(ctx.auth)).body.total).toBe(1);
    expect((await request(ctx.app).get(`/api/statements/${imp.id}`).set(ctx.auth)).body.status).toBe("needs_review");
  });

  it.skipIf(onPrisma)("statements are owner-protected and need a session", async () => {
    const imp = (await up(ctx.app, "card.csv", CARD_CSV, ctx.card)).body;
    await repo.createOwner({ email: "other@test.in", name: "Other", passwordHash: await hashPassword(PASSWORD) });
    const login = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "other@test.in", password: PASSWORD });
    const other = { Cookie: `mh_session=${cookieToken(login.headers["set-cookie"])}`, Origin: ORIGIN };
    expect((await request(ctx.app).get(`/api/statements/${imp.id}/review`).set(other)).status).toBe(404);
    expect((await request(ctx.app).post("/api/statements").set(other).field("accountId", ctx.card).attach("file", Buffer.from(CARD_CSV), "c.csv")).status).toBe(422);
    expect((await request(ctx.app).get("/api/statements")).status).toBe(401);
  });
});
