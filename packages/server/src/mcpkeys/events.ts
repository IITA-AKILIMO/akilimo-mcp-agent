import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { keyEvents, users } from "../db/schema.js";

// The trail of what admins do with keys (table key_events): created, changed, revoked, saved, removed. It never
// holds a key, only things like a name, the last characters (hint) or new limits.
export interface KeyEventInput {
  actorId?: string | null | undefined;
  kind: "client" | "shared";
  ref: string; // the client key's id, or the upstream server's id
  label: string; // what to show: the key's name, or the server's id
  action: string;
  detail?: Record<string, unknown> | undefined;
}

// A failure to write the trail must never undo or block what the admin did
export async function recordKeyEvent(db: Db, event: KeyEventInput): Promise<void> {
  try {
    await db.insert(keyEvents).values({
      actorId: event.actorId ?? null,
      kind: event.kind,
      ref: event.ref,
      label: event.label,
      action: event.action,
      detail: event.detail ?? null,
    });
  } catch (error) {
    console.error("Could not record a key event:", error);
  }
}

export interface KeyEvent {
  id: string;
  at: Date;
  actor: string | null; // username of the admin, null when unknown or removed
  kind: string;
  ref: string;
  label: string;
  action: string;
  detail: unknown;
}

export async function listKeyEvents(db: Db, limit = 50): Promise<KeyEvent[]> {
  return db
    .select({ id: keyEvents.id, at: keyEvents.at, actor: users.username, kind: keyEvents.kind, ref: keyEvents.ref, label: keyEvents.label, action: keyEvents.action, detail: keyEvents.detail })
    .from(keyEvents)
    .leftJoin(users, eq(users.id, keyEvents.actorId))
    .orderBy(desc(keyEvents.at))
    .limit(Math.min(Math.max(limit, 1), 200));
}
