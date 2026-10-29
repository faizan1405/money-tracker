/**
 * One-time owner setup. There is no public sign-up.
 *   OWNER_EMAIL=you@example.com OWNER_NAME="Faizan" npm run owner:create
 * The password is typed interactively (not stored in shell history). Refuses if an owner exists.
 */
import { createInterface } from "node:readline";
import { hashPassword } from "../src/auth.js";
import { PrismaRepo } from "../src/repo/prisma.js";

function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    const orig = out._writeToOutput.bind(out);
    let muted = false;
    out._writeToOutput = (s) => (muted ? undefined : orig(s));
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    muted = true;
  });
}

const email = process.env.OWNER_EMAIL?.trim();
const name = process.env.OWNER_NAME?.trim() || "Owner";
if (!email || !/^\S+@\S+\.\S+$/.test(email)) { console.error("Set OWNER_EMAIL to a valid email."); process.exit(1); }

const repo = new PrismaRepo();
if ((await repo.ownerCount()) > 0) { console.error("An owner already exists. Aborting."); process.exit(1); }
const pw = await askHidden("Password (min 12 chars): ");
const again = await askHidden("Repeat password: ");
if (pw.length < 12) { console.error("Password must be at least 12 characters."); process.exit(1); }
if (pw !== again) { console.error("Passwords don't match."); process.exit(1); }
const o = await repo.createOwner({ email, name, passwordHash: await hashPassword(pw) });
console.log(`Owner created: ${o.email} (Personal + Scale Flow workspaces added)`);
process.exit(0);
