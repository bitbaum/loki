/**
 * Query layer for Loki conversations + their messages. Every read/write is
 * scoped by userId (multi-user safety — one user must never read or mutate
 * another's thread). Messages are reached only through a conversation the
 * caller owns, so message writes verify ownership first.
 */
import { and, desc, eq, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  conversationMessages,
  type Conversation,
  type ConversationMessage,
} from "@/db/schema/conversations";

/** The placeholder title a fresh conversation is created with — auto-titling
 *  replaces it once the first user turn arrives. SSOT for both the create path
 *  and the "should I auto-title?" check. */
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

/** Derive a clean one-line title from the first user message: collapse all
 *  whitespace to single spaces, trim, cap at ~60 chars (append "…" if cut).
 *  Returns null if there's no usable text so callers keep the placeholder. */
export function deriveConversationTitle(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const MAX = 60;
  return cleaned.length > MAX ? `${cleaned.slice(0, MAX).trimEnd()}…` : cleaned;
}

/** List a user's non-empty conversations, newest-updated first. Optional
 *  projectKeys filter keeps only threads tagged with at least one given key.
 *  The inner join deliberately hides abandoned placeholders left by clients
 *  that created a thread but never sent a first message. */
/** What the rail knows about a thread's last message — enough to say what
 *  the thread needs from the person (lib/loki/thread-state.ts) without
 *  loading it. */
export type ConversationLastMessage = {
  preview: string;
  lastRole: string | null;
  lastKind: string | null;
  lastAt: Date | null;
  lastOk: boolean | null;
  lastOutcome: string | null;
  lastNeedsProject: boolean | null;
};

export type ConversationListRow = Pick<
  Conversation,
  "id" | "title" | "projectKeys" | "updatedAt" | "lastReadAt" | "pinnedAt"
> &
  ConversationLastMessage;

export async function listConversations(
  userId: string,
  opts: { projectKeys?: string[] } = {},
): Promise<ConversationListRow[]> {
  // The last message of each thread, for the rail: a title says what a
  // thread is about, the last message says where it stopped and what it
  // asks of the person — which is what decides whether to reopen it. Each
  // column is one correlated subquery over the same (indexed) row; no
  // second round trip.
  const last = (expr: string) => sql`(
    select ${sql.raw(expr)} from conversation_messages m
    where m.conversation_id = ${conversations.id}
    order by m.created_at desc limit 1
  )`;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      projectKeys: conversations.projectKeys,
      updatedAt: conversations.updatedAt,
      lastReadAt: conversations.lastReadAt,
      pinnedAt: conversations.pinnedAt,
      preview: sql<string>`coalesce(${last("left(m.content, 160)")}, '')`,
      lastRole: sql<string | null>`${last("m.role")}`,
      lastKind: sql<string | null>`${last("m.kind")}`,
      lastAt: sql<Date | null>`${last("m.created_at")}`,
      lastOk: sql<boolean | null>`${last("(m.meta->>'ok')::boolean")}`,
      lastOutcome: sql<string | null>`${last("m.meta->>'outcome'")}`,
      lastNeedsProject: sql<boolean | null>`${last("(m.meta->>'needsProject')::boolean")}`,
    })
    .from(conversations)
    .innerJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
    .where(eq(conversations.userId, userId))
    .groupBy(
      conversations.id,
      conversations.title,
      conversations.projectKeys,
      conversations.updatedAt,
      conversations.lastReadAt,
      conversations.pinnedAt,
    )
    .orderBy(desc(conversations.updatedAt));

  const filter = opts.projectKeys?.filter(Boolean) ?? [];
  if (filter.length === 0) return rows;
  const wanted = new Set(filter);
  return rows.filter((r) => r.projectKeys.some((k) => wanted.has(k)));
}

/** Create a new conversation. Title is required; projectKeys defaults to []. */
export async function createConversation(
  userId: string,
  { title, projectKeys = [] }: { title: string; projectKeys?: string[] },
): Promise<Conversation> {
  const [row] = await db.insert(conversations).values({ userId, title, projectKeys }).returning();
  return row;
}

/** Fetch a conversation the user owns plus its messages (oldest-first).
 *  Returns null if the conversation doesn't exist or isn't theirs. */
export async function getConversationWithMessages(
  userId: string,
  id: string,
): Promise<{ conversation: Conversation; messages: ConversationMessage[] } | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (!conversation) return null;

  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
    .orderBy(asc(conversationMessages.createdAt));

  return { conversation, messages };
}

/** Append a message to a conversation and bump the parent's updatedAt so the
 *  thread floats to the top of the list. Callers MUST have already verified
 *  the conversation belongs to the user (see getConversationWithMessages). */
export async function addMessage(
  conversationId: string,
  {
    role,
    kind,
    content,
    meta,
  }: {
    role: "user" | "assistant" | "system";
    kind?: "chat" | "command" | "dispatch" | "outcome";
    content: string;
    meta?: Record<string, unknown>;
  },
): Promise<ConversationMessage> {
  const [row] = await db
    .insert(conversationMessages)
    .values({ conversationId, role, kind: kind ?? null, content, meta: meta ?? {} })
    .returning();
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  return row;
}

/** Rename a conversation. User-scoped; returns the updated row or null if the
 *  conversation isn't theirs. Used for auto-titling the first turn. */
export async function updateConversationTitle(
  userId: string,
  id: string,
  title: string,
): Promise<Conversation | null> {
  const [row] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ?? null;
}

/** The person has the thread open now: everything written so far is read.
 *  User-scoped; a thread that is not theirs is left alone and reported. */
export async function markConversationRead(
  userId: string,
  id: string,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ lastReadAt: at })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/** Pin a thread to the top of the rail, or let it go. User-scoped. */
export async function setConversationPinned(
  userId: string,
  id: string,
  pinned: boolean,
): Promise<Conversation | null> {
  const [row] = await db
    .update(conversations)
    .set({ pinnedAt: pinned ? new Date() : null })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ?? null;
}

/** Delete a conversation the user owns (its messages cascade away with it).
 *  Returns true if a row was deleted, false if it wasn't theirs / didn't exist. */
export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

/** Replace a conversation's project tags. User-scoped; returns the updated
 *  row or null if the conversation isn't theirs. */
export async function updateConversationProjects(
  userId: string,
  id: string,
  projectKeys: string[],
): Promise<Conversation | null> {
  const [row] = await db
    .update(conversations)
    .set({ projectKeys, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * The thread behind a named channel (conversations.channel), created on first
 * use. Insert-or-nothing then read, so two updates racing for a brand-new
 * project still land in ONE thread — the unique (user_id, channel) index
 * decides, not whichever request happened to look first.
 */
export async function getOrCreateChannelConversation(
  userId: string,
  channel: string,
  init: { title: string; projectKeys: string[] },
): Promise<Conversation> {
  await db
    .insert(conversations)
    .values({ userId, channel, title: init.title, projectKeys: init.projectKeys })
    .onConflictDoNothing({ target: [conversations.userId, conversations.channel] });
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.channel, channel)))
    .limit(1);
  return row;
}
