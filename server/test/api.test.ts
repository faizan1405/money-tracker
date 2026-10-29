import request from "supertest";
import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../src/repo/memory.js";
import { ORIGIN, PASSWORD, cookieToken, makeRepo, onPrisma, setup, signIn, tx } from "./helpers.js";

const summary = (app: Parameters<typeof request>[0], auth: object, ws = "all") =>
  request(app).get(`/api/analytics/summary?from=2026-10-01&to=2026-10-31&workspace=${ws}`).set(auth);
const balances = async (app: Parameters<typeof request>[0], auth: object) =>
  Object.fromEntries(((await request(app).get("/api/accounts/balances").set(auth)).body as { accountId: string; balance: number }[]).map((b) => [b.accountId, b.balance]));

describe("auth", () => {
  it("login sets an HttpOnly cookie and never returns the token in the body", async () => {
    const { login } = await setup(await makeRepo());
    expect(login.status).toBe(200);
    expect(login.body.token).toBeUndefined();
    expect(JSON.stringify(login.body)).not.toMatch(/mh_session|token/i);
    expect(login.body.user.email).toBe("owner@test.in");
    const c = String(login.headers["set-cookie"]);
    expect(c).toMatch(/mh_session=/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=None/);
  });

  it("wrong password and unknown email both give 401", async () => {
    const { app } = await setup(await makeRepo());
    expect((await signIn(app, "owner@test.in", "nope")).status).toBe(401);
    expect((await signIn(app, "x@test.in", PASSWORD)).status).toBe(401);
  });

  it("rate-limits repeated sign-in attempts", async () => {
    const { app } = await setup(await makeRepo(), { loginLimit: 3 });
    for (let i = 0; i < 3; i++) await signIn(app, "owner@test.in", "bad");
    expect((await signIn(app, "owner@test.in", PASSWORD)).status).toBe(429);
  });

  it("all financial endpoints reject unauthenticated calls", async () => {
    const { app } = await setup(await makeRepo());
    for (const p of ["/api/bootstrap", "/api/transactions", "/api/accounts", "/api/workspaces", "/api/dues"]) {
      expect((await request(app).get(p)).status).toBe(401);
    }
    expect((await request(app).post("/api/transactions").send({ items: [] })).status).toBe(401);
  });

  it("logout kills the session", async () => {
    const { app, auth } = await setup(await makeRepo());
    expect((await request(app).post("/api/auth/logout").set(auth)).status).toBe(204);
    expect((await request(app).get("/api/bootstrap").set(auth)).status).toBe(401);
  });

  it("expired session returns session_expired", async () => {
    let t = Date.now();
    const { app, auth } = await setup(await makeRepo(), { now: () => t });
    t += 3600_000 + 1;
    const r = await request(app).get("/api/bootstrap").set(auth);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("session_expired");
  });

  it("cookie-authenticated writes need an allowed Origin (CSRF)", async () => {
    const { app, token, bank } = await setup(await makeRepo());
    const body = { items: [tx({ type: "expense", amount: 10, accountId: bank })] };
    const cookie = `mh_session=${token}`;
    expect((await request(app).post("/api/transactions").set("Cookie", cookie).set("Origin", "https://evil.test").send(body)).status).toBe(403);
    expect((await request(app).post("/api/transactions").set("Cookie", cookie).send(body)).status).toBe(403);
    expect((await request(app).post("/api/transactions").set("Cookie", cookie).set("Origin", ORIGIN).send(body)).status).toBe(201);
  });
});

describe("auth hardening", () => {
  it("a bearer header is not accepted — only the cookie", async () => {
    const { app, token } = await setup(await makeRepo());
    expect((await request(app).get("/api/bootstrap").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });
  it("sign-in from a foreign site is refused", async () => {
    const { app } = await setup(await makeRepo());
    expect((await request(app).post("/api/auth/login").set("Origin", "https://evil.test").send({ email: "owner@test.in", password: PASSWORD })).status).toBe(403);
  });
  it("/me restores the session after a refresh", async () => {
    const { app, auth } = await setup(await makeRepo());
    const r = await request(app).get("/api/auth/me").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe("owner@test.in");
    expect(new Date(r.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
  it("CORS only allows the configured frontend", async () => {
    const { app } = await setup(await makeRepo());
    const ok = await request(app).options("/api/auth/login").set("Origin", ORIGIN).set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const bad = await request(app).options("/api/auth/login").set("Origin", "https://evil.test").set("Access-Control-Request-Method", "POST");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("ownership", () => {
  it.skipIf(onPrisma)("one owner can't use or see another owner's accounts and transactions", async () => {
    const repo = new MemoryRepo();
    const a = await setup(repo);
    await request(a.app).post("/api/transactions").set(a.auth).send({ items: [tx({ type: "expense", amount: 50, accountId: a.bank })] });
    // second owner on the same storage (simulated)
    const other = await repo.createOwner({ email: "other@test.in", name: "O", passwordHash: a.owner.passwordHash });
    const login = await signIn(a.app, "other@test.in", PASSWORD);
    const auth2 = { Cookie: `mh_session=${cookieToken(login.headers["set-cookie"])}`, Origin: ORIGIN };
    expect(other.id).not.toBe(a.owner.id);
    expect((await request(a.app).get("/api/transactions").set(auth2)).body.total).toBe(0);
    const r = await request(a.app).post("/api/transactions").set(auth2).send({ items: [tx({ type: "expense", amount: 5, accountId: a.bank })] });
    expect(r.status).toBe(422);
    const txid = (await request(a.app).get("/api/transactions").set(a.auth)).body.items[0].id;
    expect((await request(a.app).patch(`/api/transactions/${txid}`).set(auth2).send({ amount: 1 })).status).toBe(404);
  });
});

describe("financial rules", () => {
  it("income and expense change totals and balances", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "income", amount: 50000, accountId: bank, category: "Salary" }), tx({ type: "expense", amount: 1200.5, accountId: bank, category: "Food" })] });
    const s = (await summary(app, auth)).body;
    expect(s.income).toBe(50000);
    expect(s.expense).toBe(1200.5);
    expect(s.net).toBe(48799.5);
    expect((await balances(app, auth))[bank]).toBe(58799.5);
  });

  it("personal → business transfer is not income or expense", async () => {
    const { app, auth, bank, biz } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "transfer", amount: 3000, accountId: bank, toAccountId: biz, category: "Transfer" })] });
    const s = (await summary(app, auth)).body;
    expect([s.income, s.expense]).toEqual([0, 0]);
    const b = await balances(app, auth);
    expect(b[bank]).toBe(7000);
    expect(b[biz]).toBe(3000);
  });

  it("card purchase counts once; paying the card bill is not another expense", async () => {
    const { app, auth, bank, card } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [
      tx({ type: "expense", amount: 2500, accountId: card, category: "Shopping" }),
      tx({ type: "cc_payment", amount: 2500, accountId: bank, toAccountId: card, category: "Card payment" }),
    ] });
    expect((await summary(app, auth)).body.expense).toBe(2500);
    const b = await balances(app, auth);
    expect(b[card]).toBe(0);
    expect(b[bank]).toBe(7500);
  });

  it("card payment must go to a credit card account", async () => {
    const { app, auth, bank, biz } = await setup(await makeRepo());
    const r = await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "cc_payment", amount: 10, accountId: bank, toAccountId: biz })] });
    expect(r.status).toBe(422);
  });

  it("refund reduces spending; loan principal is excluded, interest is an expense", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [
      tx({ type: "expense", amount: 1000, accountId: bank }),
      tx({ type: "refund", amount: 400, accountId: bank }),
      tx({ type: "loan_disbursement", amount: 100000, accountId: bank }),
      tx({ type: "loan_repayment", amount: 5000, interest: 800, accountId: bank }),
    ] });
    const s = (await summary(app, auth)).body;
    expect(s.income).toBe(0);
    expect(s.expense).toBe(1400); // 1000 - 400 + 800 interest
  });

  it("balance corrections move the balance without touching totals", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "adjustment", amount: 250, adjustmentSign: -1, accountId: bank })] });
    expect((await balances(app, auth))[bank]).toBe(9750);
    expect((await summary(app, auth)).body.net).toBe(0);
  });

  it("paise are exact: 0.1 + 0.2 = 0.3 and >2 decimals are rejected", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 0.1, accountId: bank }), tx({ type: "expense", amount: 0.2, accountId: bank })] });
    expect((await summary(app, auth)).body.expense).toBe(0.3);
    const bad = await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 1.005, accountId: bank })] });
    expect(bad.status).toBe(422);
  });

  it("editing and deleting update totals", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    const [t] = (await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 900, accountId: bank })] })).body;
    await request(app).patch(`/api/transactions/${t.id}`).set(auth).send({ amount: 1500 });
    expect((await summary(app, auth)).body.expense).toBe(1500);
    await request(app).patch(`/api/transactions/${t.id}`).set(auth).send({ type: "income" });
    expect((await summary(app, auth)).body).toMatchObject({ income: 1500, expense: 0 });
    await request(app).post("/api/transactions/delete").set(auth).send({ ids: [t.id] });
    expect((await summary(app, auth)).body).toMatchObject({ income: 0, expense: 0 });
    expect((await balances(app, auth))[bank]).toBe(10000);
  });
});

describe("duplicates and atomicity", () => {
  it("same bank reference can't be saved twice; different refs with same details are kept", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    const t = tx({ type: "expense", amount: 300, accountId: bank, merchant: "Zomato", ref: "UPI123" });
    expect((await request(app).post("/api/transactions").set(auth).send({ items: [t] })).status).toBe(201);
    const again = await request(app).post("/api/transactions").set(auth).send({ items: [t] });
    expect(again.status).toBe(409);
    expect((await request(app).post("/api/transactions").set(auth).send({ items: [{ ...t, ref: "UPI124" }] })).status).toBe(201);
    expect((await summary(app, auth)).body.expense).toBe(600);
  });

  it("a batch with one bad row saves nothing", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    const r = await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 10, accountId: bank }), tx({ type: "expense", amount: 20, accountId: "missing" })] });
    expect(r.status).toBe(422);
    const dup = await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 10, accountId: bank, ref: "R1" }), tx({ type: "expense", amount: 20, accountId: bank, ref: "R1" })] });
    expect(dup.status).toBe(409);
    expect((await request(app).get("/api/transactions").set(auth)).body.total).toBe(0);
  });
});

describe("dashboard + other endpoints", () => {
  it("workspace filter and search work and match totals", async () => {
    const { app, auth, bank, biz } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [
      tx({ type: "income", amount: 80000, accountId: biz, workspace: "scaleflow", client: "Acme", category: "Client payment" }),
      tx({ type: "expense", amount: 500, accountId: bank, merchant: "Swiggy" }),
    ] });
    expect((await summary(app, auth, "scaleflow")).body).toMatchObject({ income: 80000, expense: 0 });
    expect((await summary(app, auth, "personal")).body).toMatchObject({ income: 0, expense: 500 });
    const q = await request(app).get("/api/transactions?q=swig").set(auth);
    expect(q.body.total).toBe(1);
    const boot = (await request(app).get("/api/bootstrap").set(auth)).body;
    expect(boot.transactions).toHaveLength(2);
    expect(boot.workspaces.map((w: { id: string }) => w.id)).toEqual(["personal", "scaleflow"]);
  });

  it("unfinished modules return 501, never fake success", async () => {
    const { app, auth } = await setup(await makeRepo());
    expect((await request(app).post("/api/ai/chat").set(auth).send({ messages: [] })).status).toBe(501);
    expect((await request(app).get("/api/statements").set(auth)).status).toBe(501);
  });

  it("health reports the database honestly", async () => {
    const repo = await makeRepo();
    const { app } = await setup(repo);
    expect((await request(app).get("/api/health")).body.ok).toBe(true);
    if (repo instanceof MemoryRepo) {
      repo.down = true;
      expect((await request(app).get("/api/health")).status).toBe(503);
    }
  });

  it("an account with transactions can't be removed", async () => {
    const { app, auth, bank } = await setup(await makeRepo());
    await request(app).post("/api/transactions").set(auth).send({ items: [tx({ type: "expense", amount: 10, accountId: bank })] });
    const r = await request(app).put("/api/collections/accounts").set(auth).send({ items: [] });
    expect(r.status).toBe(409);
  });
});

describe("collections", () => {
  it("loans, budgets, goals, recurring and rules save and read back exactly", async () => {
    const { app, auth } = await setup(await makeRepo());
    const dues = [{ id: "x", direction: "i_owe", kind: "loan", party: "SBI", principal: 500000, outstanding: 412345.67, dueDate: "2026-11-05", interestRate: 9.25, emi: 10432.1, workspace: "personal", payments: [{ date: "2026-10-05", amount: 10432.1, interest: 3100.55 }] }];
    const budgets = [{ id: "b", category: "Food", workspace: "personal", limit: 8000.5 }];
    const rules = [{ id: "r", match: "swiggy", category: "Food", workspace: "personal", priority: 1, enabled: true }];
    for (const [k, items] of [["dues", dues], ["budgets", budgets], ["rules", rules], ["goals", [{ id: "g", name: "Car", target: 800000, saved: 1234.5, deadline: "2027-12-31" }]], ["recurring", [{ id: "s", name: "Netflix", amount: 649, category: "Subscriptions", workspace: "personal", nextDate: "2026-11-01", cadence: "monthly" }]], ["customCategories", ["Pets"]]] as const) {
      expect((await request(app).put(`/api/collections/${k}`).set(auth).send({ items })).status).toBe(200);
    }
    const b = (await request(app).get("/api/bootstrap").set(auth)).body;
    expect(b.dues[0]).toMatchObject({ party: "SBI", outstanding: 412345.67, interestRate: 9.25, emi: 10432.1 });
    expect(b.dues[0].payments[0]).toMatchObject({ amount: 10432.1, interest: 3100.55 });
    expect(b.budgets[0].limit).toBe(8000.5);
    expect(b.goals[0].saved).toBe(1234.5);
    expect(b.recurring[0].amount).toBe(649);
    expect(b.rules[0].match).toBe("swiggy");
    expect(b.customCategories).toEqual(["Pets"]);
    expect((await request(app).put("/api/collections/budgets").set(auth).send({ items: [{ id: "b", category: "Food", workspace: "personal", limit: 1.234 }] })).status).toBe(422);
  });
});
