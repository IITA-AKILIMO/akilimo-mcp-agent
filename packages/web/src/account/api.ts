// Client for the accounts API on the Akilimo 1.0 server (packages/server/src/accounts), reached
// through the same-origin /api path; the session is an HttpOnly cookie the browser sends itself
import type { MCPEvent } from '@akilimo/shared';
import type { ChatMessage } from '../llm/types';

export type Role = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: Role;
}

export interface AdminUser extends User {
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  updated_at: string;
}

const request = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // Always JSON: the server rejects other content types on writes (CSRF guard)
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
};

export const getStatus = () => request<{ enabled: boolean; user: User | null }>('GET', '/auth/status');
export const signUp = (name: string, email: string, username: string, password: string) =>
  request<{ user: User }>('POST', '/auth/signup', { name, email, username, password });
// `login` is an email or a username
export const signIn = (login: string, password: string) => request<{ user: User }>('POST', '/auth/login', { login, password });
export const signOut = () => request<void>('POST', '/auth/logout');

export const listConversations = () => request<{ conversations: ConversationSummary[] }>('GET', '/conversations');
export const createConversation = (title: string, model?: string) =>
  request<ConversationSummary>('POST', '/conversations', { title, model });
export const getConversation = (id: string) =>
  request<{ conversation: ConversationSummary; messages: ChatMessage[] }>('GET', `/conversations/${id}`);
export const appendMessages = (id: string, messages: ChatMessage[]) =>
  request<void>('POST', `/conversations/${id}/messages`, { messages });
export const deleteConversation = (id: string) => request<void>('DELETE', `/conversations/${id}`);

interface StoredEvent { id: string; type: MCPEvent['type']; server: string; message: string; payload: unknown; created_at: string }
export const loadActivity = async (): Promise<MCPEvent[]> => {
  const { activity } = await request<{ activity: StoredEvent[] }>('GET', '/activity');
  return activity.map(e => ({ id: `db-${e.id}`, type: e.type, server: e.server, message: e.message, payload: e.payload ?? undefined, timestamp: new Date(e.created_at) }));
};
export const saveActivity = (events: MCPEvent[]) =>
  request<void>('POST', '/activity', {
    events: events.map(e => ({ type: e.type, server: e.server, message: e.message, payload: e.payload, timestamp: e.timestamp.toISOString() })),
  });
export const clearActivity = () => request<void>('DELETE', '/activity');

// Admin only
export const listUsers = () => request<{ users: AdminUser[] }>('GET', '/admin/users');
export const setUserRole = (id: string, role: Role) => request<void>('PATCH', `/admin/users/${id}`, { role });
