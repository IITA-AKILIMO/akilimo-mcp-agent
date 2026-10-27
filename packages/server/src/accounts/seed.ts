import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import { hashPassword, usernameFromEmail, UsernameSchema } from "./auth.js";

export interface AdminSeed {
  email: string;
  password: string;
  name: string;
  username?: string | undefined;
}

const SeedSchema = z.object({
  email: z.email("ADMIN_EMAIL must be a valid email address").trim().toLowerCase(),
  password: z.string().min(8, "ADMIN_PASSWORD must have at least 8 characters").max(200),
  name: z.string().trim().min(1).max(100),
  username: UsernameSchema.optional(),
});

// Makes sure an admin account exists for the given email. Safe to run on every start:
// creates the account if missing, promotes an existing one, and never changes a password or username.
export async function seedAdmin(db: Db, seed: AdminSeed): Promise<string> {
  const parsed = SeedSchema.safeParse(seed);
  if (!parsed.success) {
    // Name the variable when the message does not already (the username rules are shared with sign-up)
    const messages = parsed.error.issues.map((i) =>
      i.message.startsWith("ADMIN_") ? i.message : `ADMIN_${String(i.path[0]).toUpperCase()}: ${i.message}`);
    throw new Error(`Cannot seed admin: ${messages.join("; ")}`);
  }
  const { email, password, name, username } = parsed.data;
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, role: true, username: true } });

  if (!existing) {
    const created = await db.user.create({
      data: { email, username: await freeUsername(db, username, email), name, passwordHash: await hashPassword(password), role: "admin" },
      select: { username: true },
    });
    return `Created admin account ${email} (username ${created.username})`;
  }
  if (existing.role !== "admin") {
    await db.user.update({ where: { id: existing.id }, data: { role: "admin" } });
    return `Promoted existing account ${email} (username ${existing.username}) to admin (password unchanged)`;
  }
  return `Admin account ${email} (username ${existing.username}) already exists (password unchanged)`;
}

// ADMIN_USERNAME must be free; a username derived from the email gets a short suffix when taken
async function freeUsername(db: Db, wanted: string | undefined, email: string): Promise<string> {
  const isTaken = async (candidate: string) => (await db.user.count({ where: { username: candidate } })) > 0;
  if (wanted) {
    if (await isTaken(wanted)) throw new Error(`Cannot seed admin: ADMIN_USERNAME "${wanted}" belongs to another account`);
    return wanted;
  }
  const base = usernameFromEmail(email);
  if (!(await isTaken(base))) return base;
  for (;;) {
    const candidate = `${base.slice(0, 21)}-${randomBytes(4).toString("hex")}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
