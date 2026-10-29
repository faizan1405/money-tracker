import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import type { Repo } from "../src/repo/types.js";

export const ORIGIN = "https://app.moneyhub.test";
export const config: AppConfig = { isProd: false, port: 0, corsOrigins: [ORIGIN], sessionTtlMs: 3600_000, crossSiteCookies: true, uploadMaxBytes: 1e6, version: "test" };
export const PASSWORD = "correct horse battery";

export async function setup(repo: Repo, opts: { now?: () => number; loginLimit?: number } = {}) {
  const owner = await repo.createOwner({ email: "owner@test.in", name: "Owner", passwordHash: await hashPassword(PASSWORD) });
  const app = createApp({ repo, config, ...opts });
  const login = await request(app).post("/api/auth/login").send({ email: "owner@test.in", password: PASSWORD });
  const token = login.body.token as string;
  const auth = { Authorization: `Bearer ${token}` };
  await request(app).put("/api/collections/accounts").set(auth).send({
    items: [
      { id: "new-bank", name: "HDFC", institution: "HDFC", kind: "bank", workspace: "personal", openingBalance: 10000 },
      { id: "new-biz", name: "ICICI Biz", institution: "ICICI", kind: "bank", workspace: "scaleflow", openingBalance: 0 },
      { id: "new-card", name: "Card", institution: "Axis", kind: "credit_card", workspace: "personal", openingBalance: 0 },
    ],
  });
  const accs = (await request(app).get("/api/accounts").set(auth)).body as { id: string; name: string }[];
  const id = (n: string) => accs.find((a) => a.name === n)!.id;
  return { app, owner, token, auth, bank: id("HDFC"), biz: id("ICICI Biz"), card: id("Card"), login };
}

export const tx = (o: Record<string, unknown>) => ({ date: "2026-10-05", description: "", merchant: "", category: "Other", workspace: "personal", status: "cleared", ...o });
