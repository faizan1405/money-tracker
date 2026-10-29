// Temporary: fictional data for the browser test (isolated test DB).
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth.js";
import { PrismaRepo } from "../src/repo/prisma.js";
import { toPaise } from "../src/money.js";
const prisma = new PrismaClient();
await prisma.transaction.deleteMany(); await prisma.owner.deleteMany();
const repo = new PrismaRepo(prisma);
const o = await repo.createOwner({ email: "faizan@fictional.test", name: "Faizan", passwordHash: await hashPassword("fictional password 1") });
const accs = await repo.replaceAccounts(o.id, [
  { id: "x1", name: "HDFC Savings", institution: "HDFC", kind: "bank", workspace: "personal", openingBalancePaise: 5_000_000, reconciled: "reconciled" },
  { id: "x2", name: "ICICI Current", institution: "ICICI", kind: "bank", workspace: "scaleflow", openingBalancePaise: 2_000_000, reconciled: "never" },
  { id: "x3", name: "Axis Card", institution: "Axis", kind: "credit_card", workspace: "personal", openingBalancePaise: 0, reconciled: "never" },
] as never);
const A = (n: string) => accs.find((a) => a.name === n)!.id;
const t = (date: string, type: string, rs: number, merchant: string, category: string, acc: string, workspace = "personal", extra: Record<string, unknown> = {}) =>
  ({ date, type, amountPaise: toPaise(rs), merchant, description: merchant, category, workspace, accountId: A(acc), status: "cleared", recurring: false, source: "manual", ...extra });
const items = ["2026-07", "2026-08", "2026-09", "2026-10"].flatMap((m, i) => [
  t(`${m}-02`, "expense", 649, "Netflix", "Subscriptions", "Axis Card"),
  t(`${m}-03`, "expense", 1200 + i * 300, "Swiggy", "Food & Dining", "HDFC Savings"),
  t(`${m}-05`, "income", 60000 + i * 10000, "Acme Corp", "Client Payment", "ICICI Current", "scaleflow"),
  t(`${m}-06`, "expense", 8000 + i * 2500, "Meta", "Meta Ads", "ICICI Current", "scaleflow"),
  t(`${m}-07`, "expense", 1800, "Hostinger", "Hosting & Domains", "ICICI Current", "scaleflow"),
  t(`${m}-12`, "expense", 2500 + i * 1500, "Amazon", "Shopping", "Axis Card"),
  t(`${m}-01`, "income", 90000, "Salary Co", "Salary", "HDFC Savings"),
]);
await repo.createTxns(o.id, items as never);
await repo.replaceCollection(o.id, "dues", [{ id: "d1", direction: "owed_to_me", kind: "client", party: "Beta Studio", principal: 35000, outstanding: 35000, dueDate: "2026-10-12", workspace: "scaleflow", payments: [] }]);
console.log("seeded", items.length);
await prisma.$disconnect();
