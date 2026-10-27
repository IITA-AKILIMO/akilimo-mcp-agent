import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import express, { type Request, type Response } from "express";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import { activity, conversations, messages, users } from "../db/schema.js";
import {
  endSession, hashPassword, loadUser, rateLimit, requireAdmin, requireJson, requireUser, startSession, USER_SELECT,
  UsernameSchema, verifyPassword,
} from "./auth.js";

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
  username: UsernameSchema,
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

// `login` is an email or a username; `email` is still accepted from older clients
const LoginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, "Enter your email or username"),
  password: z.string(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().max(200_000).default(""),
  tool_calls: z.array(z.unknown()).max(20).optional(),
  tool_name: z.string().max(200).optional(),
  // A guided step (action, country, request and result); capped so one row cannot grow without limit
  data: z.unknown().refine((v) => v === undefined || JSON.stringify(v).length <= 500_000, "Step data is too large").optional(),
});

const ConversationModeSchema = z.enum(["ai", "guided"]);

const ConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  model: z.string().max(100).optional(),
  mode: ConversationModeSchema.default("ai"),
});

const RoleSchema = z.object({ role: z.enum(["user", "admin"]) });

const ActivitySchema = z.object({
  type: z.string().max(40),
  server: z.string().max(100),
  message: z.string().max(2000),
  payload: z.unknown().optional(),
  timestamp: z.iso.datetime().optional(),
});

// Compared against when the email is unknown, so sign-in takes the same time either way
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

// PostgreSQL error 23505 (unique_violation); Drizzle wraps the driver's error as `cause`
const isUniqueViolation = (error: unknown) =>
  [error, (error as { cause?: unknown } | null)?.cause].some((e) => (e as { code?: string } | null)?.code === "23505");

// Ids are UUIDs in the database; anything else cannot match a row (and would be a query error)
const isUuid = (value: string) => z.uuid().safeParse(value).success;

// The web client expects snake_case fields
const conversationJson = (c: { id: string; title: string; model: string | null; mode: string; createdAt: Date; updatedAt: Date }) =>
  ({ id: c.id, title: c.title, model: c.model, mode: c.mode, created_at: c.createdAt, updated_at: c.updatedAt });

const sendError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues.map((i) => i.message).join("; ") });
  } else {
    console.error("API error:", error);
    res.status(500).json({ error: "Something went wrong on the server" });
  }
};

const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => fn(req, res).catch((error) => sendError(res, error));

export function apiRouter(db: Db | null) {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  if (!db) {
    // Accounts need a database (DB_*); the UI then offers guest use only
    router.get("/auth/status", (req, res) => res.json({ enabled: false, user: null }));
    router.use((req, res) => res.status(503).json({ error: "Accounts are not enabled on this server" }));
    return router;
  }

  router.use(requireJson);
  router.use(loadUser(db));
  const authLimit = rateLimit(10, 15 * 60 * 1000);

  // ── Accounts ──────────────────────────────────────────────────────────────
  router.get("/auth/status", (req, res) => {
    res.json({ enabled: true, user: req.user ?? null });
  });

  router.post("/auth/signup", authLimit, handle(async (req, res) => {
    const { name, email, username, password } = SignupSchema.parse(req.body);
    // Checked first so the message says which one is taken; the unique constraints still decide races
    const [taken] = await db.select({ email: users.email }).from(users)
      .where(or(eq(users.email, email), eq(users.username, username))).limit(1);
    if (taken) {
      res.status(409).json({
        error: taken.email === email
          ? "An account with this email already exists. Sign in instead."
          : "This username is taken. Choose another one.",
      });
      return;
    }
    const passwordHash = await hashPassword(password);
    let user;
    try {
      [user] = await db.insert(users).values({ email, username, name, passwordHash }).returning(USER_SELECT);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      res.status(409).json({ error: "This email or username was just taken. Try again." });
      return;
    }
    await startSession(db, req, res, user!.id);
    res.status(201).json({ user });
  }));

  router.post("/auth/login", authLimit, handle(async (req, res) => {
    const { login, password } = LoginSchema.parse({ ...req.body, login: req.body?.login ?? req.body?.email });
    const [user] = await db.select({ ...USER_SELECT, passwordHash: users.passwordHash }).from(users)
      .where(login.includes("@") ? eq(users.email, login) : eq(users.username, login)).limit(1);
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      res.status(401).json({ error: "Email, username or password is incorrect" });
      return;
    }
    await startSession(db, req, res, user.id);
    const { passwordHash: _, ...publicUser } = user;
    res.json({ user: publicUser });
  }));

  router.post("/auth/logout", handle(async (req, res) => {
    await endSession(db, req, res);
    res.status(204).end();
  }));

  // Everything below belongs to the signed-in user only
  router.use(requireUser);

  // ── Conversations ─────────────────────────────────────────────────────────
  router.get("/conversations", handle(async (req, res) => {
    // ?mode=ai|guided narrows the list to one kind of conversation
    const mode = ConversationModeSchema.safeParse(req.query.mode);
    const rows = await db.select().from(conversations)
      .where(mode.success
        ? and(eq(conversations.userId, req.user!.id), eq(conversations.mode, mode.data))
        : eq(conversations.userId, req.user!.id))
      .orderBy(desc(conversations.updatedAt)).limit(200);
    res.json({ conversations: rows.map(conversationJson) });
  }));

  router.post("/conversations", handle(async (req, res) => {
    const { title, model, mode } = ConversationSchema.parse(req.body);
    const [conversation] = await db.insert(conversations).values({ userId: req.user!.id, title, model: model ?? null, mode }).returning();
    res.status(201).json(conversationJson(conversation!));
  }));

  router.get("/conversations/:id", handle(async (req, res) => {
    const id = String(req.params.id);
    const [conversation] = isUuid(id)
      ? await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, req.user!.id))).limit(1)
      : [];
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const history = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.id));
    res.json({
      conversation: conversationJson(conversation),
      messages: history.map((m) => ({
        role: m.role, content: m.content, tool_calls: m.toolCalls, tool_name: m.toolName, data: m.data, created_at: m.createdAt,
      })),
    });
  }));

  router.post("/conversations/:id/messages", handle(async (req, res) => {
    const incoming = z.array(MessageSchema).min(1).max(50).parse(req.body.messages);
    const id = String(req.params.id);
    const owned = isUuid(id) && await db.$count(conversations, and(eq(conversations.id, id), eq(conversations.userId, req.user!.id)));
    if (!owned) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    // One multi-row insert in a transaction: ids follow the order sent, and the chat is touched too
    await db.transaction(async (tx) => {
      await tx.insert(messages).values(incoming.map((m) => ({
        conversationId: id,
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls ?? null,
        toolName: m.tool_name ?? null,
        data: m.data ?? null,
      })));
      await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id));
    });
    res.status(204).end();
  }));

  router.patch("/conversations/:id", handle(async (req, res) => {
    const { title } = ConversationSchema.pick({ title: true }).parse(req.body);
    const id = String(req.params.id);
    const updated = isUuid(id)
      ? await db.update(conversations).set({ title, updatedAt: new Date() })
        .where(and(eq(conversations.id, id), eq(conversations.userId, req.user!.id))).returning({ id: conversations.id })
      : [];
    res.status(updated.length ? 204 : 404).end();
  }));

  router.delete("/conversations/:id", handle(async (req, res) => {
    const id = String(req.params.id);
    const deleted = isUuid(id)
      ? await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, req.user!.id))).returning({ id: conversations.id })
      : [];
    res.status(deleted.length ? 204 : 404).end();
  }));

  // ── Activity ──────────────────────────────────────────────────────────────
  router.get("/activity", handle(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const recent = await db.select().from(activity)
      .where(eq(activity.userId, req.user!.id)).orderBy(desc(activity.id)).limit(limit);
    res.json({
      activity: recent.reverse().map((a) => ({
        id: String(a.id), type: a.type, server: a.server, message: a.message, payload: a.payload, created_at: a.createdAt,
      })),
    });
  }));

  router.post("/activity", handle(async (req, res) => {
    const events = z.array(ActivitySchema).min(1).max(100).parse(req.body.events);
    // One multi-row insert keeps insertion order
    await db.insert(activity).values(events.map((e) => ({
      userId: req.user!.id,
      type: e.type,
      server: e.server,
      message: e.message,
      payload: e.payload ?? null,
      createdAt: e.timestamp ? new Date(e.timestamp) : new Date(),
    })));
    res.status(204).end();
  }));

  router.delete("/activity", handle(async (req, res) => {
    await db.delete(activity).where(eq(activity.userId, req.user!.id));
    res.status(204).end();
  }));

  // ── Admin: users and roles ────────────────────────────────────────────────
  router.get("/admin/users", requireAdmin, handle(async (req, res) => {
    const rows = await db.select({ ...USER_SELECT, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt));
    res.json({ users: rows.map(({ createdAt, ...u }) => ({ ...u, created_at: createdAt })) });
  }));

  router.patch("/admin/users/:id", requireAdmin, handle(async (req, res) => {
    const { role } = RoleSchema.parse(req.body);
    const id = String(req.params.id);
    const [target] = isUuid(id) ? await db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1) : [];
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Never leave the system without an admin (including an admin demoting themselves)
    if (target.role === "admin" && role !== "admin") {
      const otherAdmins = await db.$count(users, and(eq(users.role, "admin"), ne(users.id, id)));
      if (!otherAdmins) {
        res.status(409).json({ error: "This is the last admin; make someone else an admin first" });
        return;
      }
    }
    await db.update(users).set({ role }).where(eq(users.id, id));
    res.status(204).end();
  }));

  return router;
}
