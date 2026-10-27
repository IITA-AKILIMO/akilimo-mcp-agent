import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import { hashPassword } from "./auth.js";

export interface AdminSeed {
  email: string;
  password: string;
  name: string;
}

const SeedSchema = z.object({
  email: z.email("ADMIN_EMAIL must be a valid email address").trim().toLowerCase(),
  password: z.string().min(8, "ADMIN_PASSWORD must have at least 8 characters").max(200),
  name: z.string().trim().min(1).max(100),
});

// Makes sure an admin account exists for the given email. Safe to run on every start:
// creates the account if missing, promotes an existing one, and never changes a password.
export async function seedAdmin(db: Db, seed: AdminSeed): Promise<string> {
  const parsed = SeedSchema.safeParse(seed);
  if (!parsed.success) throw new Error(`Cannot seed admin: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const { email, password, name } = parsed.data;
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (!existing) {
    await db.user.create({ data: { email, name, passwordHash: await hashPassword(password), role: "admin" } });
    return `Created admin account ${email}`;
  }
  if (existing.role !== "admin") {
    await db.user.update({ where: { id: existing.id }, data: { role: "admin" } });
    return `Promoted existing account ${email} to admin (password unchanged)`;
  }
  return `Admin account ${email} already exists (password unchanged)`;
}
