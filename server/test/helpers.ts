import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import type { Repo } from "../src/repo/types.js";
import { MemoryRepo } from "../src/repo/memory.js";

/** TEST_DATABASE_URL set → run against a real MySQL/MariaDB through PrismaRepo (tables wiped per test). */
export const onPrisma = !!process.env["TEST_DATABASE_URL"];
let prisma: import("@prisma/client").PrismaClient | null = null;
export async function makeRepo(): Promise<Repo> {
  if (!onPrisma) return new MemoryRepo();
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaRepo } = await import("../src/repo/prisma.js");
  prisma ??= new PrismaClient({ datasourceUrl: process.env["TEST_DATABASE_URL"]! });
  await prisma.transaction.deleteMany(); // accounts are protected while transactions reference them
  await prisma.owner.deleteMany(); // cascades to every other owned table
  return new PrismaRepo(prisma);
}

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
