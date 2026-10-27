import express, { type Request, type Response } from "express";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import {
  endSession, hashPassword, loadUser, rateLimit, requireAdmin, requireJson, requireUser, startSession, verifyPassword,
} from "./auth.js";

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().max(200_000).default(""),
  tool_calls: z.array(z.unknown()).max(20).optional(),
  tool_name: z.string().max(200).optional(),
});

const ConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  model: z.string().max(100).optional(),
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

// Prisma error code for a unique constraint violation
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

// The web client expects snake_case fields, as the API returned before Prisma
const conversationJson = (c: { id: string; title: string; model: string | null; createdAt: Date; updatedAt: Date }) =>
  ({ id: c.id, title: c.title, model: c.model, created_at: c.createdAt, updated_at: c.updatedAt });

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
    const { name, email, password } = SignupSchema.parse(req.body);
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await db.user.create({ data: { email, name, passwordHash }, select: { id: true, email: true, name: true, role: true } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
      return;
    }
    await startSession(db, req, res, user.id);
    res.status(201).json({ user });
  }));

  router.post("/auth/login", authLimit, handle(async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, passwordHash: true } });
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      res.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    await startSession(db, req, res, user.id);
    res.json({ user: { id: user.id, email, name: user.name, role: user.role } });
  }));

  router.post("/auth/logout", handle(async (req, res) => {
    await endSession(db, req, res);
    res.status(204).end();
  }));

  // Everything below belongs to the signed-in user only
  router.use(requireUser);

  // ── Conversations ─────────────────────────────────────────────────────────
  router.get("/conversations", handle(async (req, res) => {
    const conversations = await db.conversation.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json({ conversations: conversations.map(conversationJson) });
  }));

  router.post("/conversations", handle(async (req, res) => {
    const { title, model } = ConversationSchema.parse(req.body);
    const conversation = await db.conversation.create({ data: { userId: req.user!.id, title, model: model ?? null } });
    res.status(201).json(conversationJson(conversation));
  }));

  router.get("/conversations/:id", handle(async (req, res) => {
    const conversation = await db.conversation.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
      include: { messages: { orderBy: { id: "asc" } } },
    });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({
      conversation: conversationJson(conversation),
      messages: conversation.messages.map((m) => ({
        role: m.role, content: m.content, tool_calls: m.toolCalls, tool_name: m.toolName, created_at: m.createdAt,
      })),
    });
  }));

  router.post("/conversations/:id/messages", handle(async (req, res) => {
    const messages = z.array(MessageSchema).min(1).max(50).parse(req.body.messages);
    const id = String(req.params.id);
    const owned = await db.conversation.count({ where: { id, userId: req.user!.id } });
    if (!owned) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    // Sequential inserts in one transaction keep the messages' order (ids) as sent
    await db.$transaction([
      ...messages.map((m) => db.message.create({
        data: {
          conversationId: id,
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { toolCalls: m.tool_calls as object[] } : {}),
          toolName: m.tool_name ?? null,
        },
      })),
      db.conversation.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    res.status(204).end();
  }));

  router.patch("/conversations/:id", handle(async (req, res) => {
    const { title } = ConversationSchema.pick({ title: true }).parse(req.body);
    const { count } = await db.conversation.updateMany({
      where: { id: String(req.params.id), userId: req.user!.id },
      data: { title, updatedAt: new Date() },
    });
    res.status(count ? 204 : 404).end();
  }));

  router.delete("/conversations/:id", handle(async (req, res) => {
    const { count } = await db.conversation.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
    res.status(count ? 204 : 404).end();
  }));

  // ── Activity ──────────────────────────────────────────────────────────────
  router.get("/activity", handle(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const recent = await db.activity.findMany({ where: { userId: req.user!.id }, orderBy: { id: "desc" }, take: limit });
    res.json({
      activity: recent.reverse().map((a) => ({
        id: String(a.id), type: a.type, server: a.server, message: a.message, payload: a.payload, created_at: a.createdAt,
      })),
    });
  }));

  router.post("/activity", handle(async (req, res) => {
    const events = z.array(ActivitySchema).min(1).max(100).parse(req.body.events);
    // createMany keeps insertion order
    await db.activity.createMany({
      data: events.map((e) => ({
        userId: req.user!.id,
        type: e.type,
        server: e.server,
        message: e.message,
        ...(e.payload === undefined || e.payload === null ? {} : { payload: e.payload as object }),
        createdAt: e.timestamp ? new Date(e.timestamp) : new Date(),
      })),
    });
    res.status(204).end();
  }));

  router.delete("/activity", handle(async (req, res) => {
    await db.activity.deleteMany({ where: { userId: req.user!.id } });
    res.status(204).end();
  }));

  // ── Admin: users and roles ────────────────────────────────────────────────
  router.get("/admin/users", requireAdmin, handle(async (req, res) => {
    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.createdAt })) });
  }));

  router.patch("/admin/users/:id", requireAdmin, handle(async (req, res) => {
    const { role } = RoleSchema.parse(req.body);
    const id = String(req.params.id);
    const target = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Never leave the system without an admin (including an admin demoting themselves)
    if (target.role === "admin" && role !== "admin") {
      const otherAdmins = await db.user.count({ where: { role: "admin", id: { not: id } } });
      if (!otherAdmins) {
        res.status(409).json({ error: "This is the last admin; make someone else an admin first" });
        return;
      }
    }
    await db.user.update({ where: { id }, data: { role } });
    res.status(204).end();
  }));

  return router;
}
