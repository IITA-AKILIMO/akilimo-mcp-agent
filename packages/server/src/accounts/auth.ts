import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import { sessions, users, type Role } from "../db/schema.js";

export type { Role };

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: Role;
  // The user's choice to let the AI chat search the internet, for every conversation
  web_search: boolean;
}

// The fields every API response and req.user carry
export const USER_SELECT = { id: users.id, email: users.email, username: users.username, name: users.name, role: users.role, web_search: users.webSearch };

// Usernames never contain "@", so sign-in can tell them apart from emails
export const UsernameSchema = z.string({ error: "Choose a username" }).trim().toLowerCase()
  .min(3, "Use at least 3 characters for the username")
  .max(30, "Use at most 30 characters for the username")
  .regex(/^[a-z0-9._-]+$/, "Usernames may only contain letters, digits, dots, underscores and hyphens");

// Same rules as the add_username migration's backfill: the email's local part, cleaned and padded
export const usernameFromEmail = (email: string) => {
  const cleaned = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
  return cleaned.length >= 3 ? cleaned : `${cleaned}user`;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const SESSION_COOKIE = "akilimo_session";
const SESSION_DAYS = 30;

// scrypt parameters from the OWASP password storage guidance; stored with the hash so they can change
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scryptAsync = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const readCookie = (req: Request, name: string) => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};

// Secure only over HTTPS so local http://localhost development still works
const cookieOptions = (req: Request) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: req.secure,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
});

export async function startSession(db: Db, req: Request, res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

export async function endSession(db: Db, req: Request, res: Response): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(req), maxAge: undefined });
}

// Attaches req.user when the session cookie is valid; never rejects on its own
export const loadUser = (db: Db) => async (req: Request, res: Response, next: NextFunction) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    try {
      const [user] = await db.select(USER_SELECT).from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
        .limit(1);
      req.user = user;
    } catch (error) {
      next(error);
      return;
    }
  }
  next();
};

export const requireUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
};

// Admin actions (MCP server registry, user roles) need a signed-in admin
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in as an admin to do this" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Only admins can do this" });
    return;
  }
  next();
};

// Browsers cannot send a cross-site JSON request without a CORS preflight, so requiring JSON on
// state-changing requests (with the SameSite=Lax cookie) blocks cross-site request forgery
export const requireJson = (req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    res.status(415).json({ error: "Send requests as application/json" });
    return;
  }
  next();
};

// Fixed-window limiter for sign-up and sign-in, per client IP
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      next();
      return;
    }
    if (++entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1000));
      res.status(429).json({ error: "Too many attempts, try again in a few minutes" });
      return;
    }
    next();
  };
}
