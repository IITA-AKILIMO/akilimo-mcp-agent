import express, { type Request, type Response } from "express";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import {
  endSession, hashPassword, loadUser, rateLimit, requireJson, requireUser, startSession, verifyPassword,
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

const ActivitySchema = z.object({
  type: z.string().max(40),
  server: z.string().max(100),
  message: z.string().max(2000),
  payload: z.unknown().optional(),
  timestamp: z.iso.datetime().optional(),
});

// Compared against when the email is unknown, so sign-in takes the same time either way
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

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
    // Accounts need DATABASE_URL; the UI then offers guest use only
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
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id",
      [email, name, passwordHash],
    );
    if (!rows[0]) {
      res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
      return;
    }
    await startSession(db, req, res, rows[0].id);
    res.status(201).json({ user: { id: rows[0].id, email, name } });
  }));

  router.post("/auth/login", authLimit, handle(async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    const { rows } = await db.query<{ id: string; name: string; password_hash: string }>(
      "SELECT id, name, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) {
      res.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    await startSession(db, req, res, user.id);
    res.json({ user: { id: user.id, email, name: user.name } });
  }));

  router.post("/auth/logout", handle(async (req, res) => {
    await endSession(db, req, res);
    res.status(204).end();
  }));

  // Everything below belongs to the signed-in user only
  router.use(requireUser);

  // ── Conversations ─────────────────────────────────────────────────────────
  router.get("/conversations", handle(async (req, res) => {
    const { rows } = await db.query(
      "SELECT id, title, model, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200",
      [req.user!.id],
    );
    res.json({ conversations: rows });
  }));

  router.post("/conversations", handle(async (req, res) => {
    const { title, model } = ConversationSchema.parse(req.body);
    const { rows } = await db.query(
      "INSERT INTO conversations (user_id, title, model) VALUES ($1, $2, $3) RETURNING id, title, model, created_at, updated_at",
      [req.user!.id, title, model ?? null],
    );
    res.status(201).json(rows[0]);
  }));

  router.get("/conversations/:id", handle(async (req, res) => {
    const { rows: [conversation] } = await db.query(
      "SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = $1 AND user_id = $2",
      [String(req.params.id), req.user!.id],
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const { rows: messages } = await db.query(
      "SELECT role, content, tool_calls, tool_name, created_at FROM messages WHERE conversation_id = $1 ORDER BY id",
      [conversation.id],
    );
    res.json({ conversation, messages });
  }));

  router.post("/conversations/:id/messages", handle(async (req, res) => {
    const messages = z.array(MessageSchema).min(1).max(50).parse(req.body.messages);
    const id = String(req.params.id);
    const owned = await db.query("SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2", [id, req.user!.id]);
    if (!owned.rowCount) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const m of messages) {
        await client.query(
          "INSERT INTO messages (conversation_id, role, content, tool_calls, tool_name) VALUES ($1, $2, $3, $4, $5)",
          [id, m.role, m.content, m.tool_calls ? JSON.stringify(m.tool_calls) : null, m.tool_name ?? null],
        );
      }
      await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  }));

  router.patch("/conversations/:id", handle(async (req, res) => {
    const { title } = ConversationSchema.pick({ title: true }).parse(req.body);
    const result = await db.query(
      "UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3",
      [title, String(req.params.id), req.user!.id],
    );
    res.status(result.rowCount ? 204 : 404).end();
  }));

  router.delete("/conversations/:id", handle(async (req, res) => {
    const result = await db.query("DELETE FROM conversations WHERE id = $1 AND user_id = $2", [String(req.params.id), req.user!.id]);
    res.status(result.rowCount ? 204 : 404).end();
  }));

  // ── Activity ──────────────────────────────────────────────────────────────
  router.get("/activity", handle(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await db.query(
      `SELECT id, type, server, message, payload, created_at FROM
         (SELECT * FROM activity WHERE user_id = $1 ORDER BY id DESC LIMIT $2) recent
       ORDER BY id`,
      [req.user!.id, limit],
    );
    res.json({ activity: rows });
  }));

  router.post("/activity", handle(async (req, res) => {
    const events = z.array(ActivitySchema).min(1).max(100).parse(req.body.events);
    const values: unknown[] = [];
    const placeholders = events.map((e, i) => {
      values.push(req.user!.id, e.type, e.server, e.message, e.payload === undefined ? null : JSON.stringify(e.payload), e.timestamp ?? new Date().toISOString());
      const b = i * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    });
    await db.query(`INSERT INTO activity (user_id, type, server, message, payload, created_at) VALUES ${placeholders.join(", ")}`, values);
    res.status(204).end();
  }));

  router.delete("/activity", handle(async (req, res) => {
    await db.query("DELETE FROM activity WHERE user_id = $1", [req.user!.id]);
    res.status(204).end();
  }));

  return router;
}
