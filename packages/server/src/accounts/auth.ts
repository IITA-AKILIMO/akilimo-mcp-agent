import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db/index.js";

export interface User {
  id: string;
  email: string;
  name: string;
}

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
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000) },
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

export async function endSession(db: Db, req: Request, res: Response): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(req), maxAge: undefined });
}

// Attaches req.user when the session cookie is valid; never rejects on its own
export const loadUser = (db: Db) => async (req: Request, res: Response, next: NextFunction) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    try {
      const session = await db.session.findFirst({
        where: { tokenHash: sha256(token), expiresAt: { gt: new Date() } },
        select: { user: { select: { id: true, email: true, name: true } } },
      });
      req.user = session?.user;
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
