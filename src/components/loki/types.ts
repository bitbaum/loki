import type { Thinking } from "@bitbaum/chatkit/react";
import type { Conversation, ConversationMessage } from "@/db/schema/conversations";

/** Left-pane row — the subset listConversations() returns (dates arrive as
 *  ISO strings over the wire). */
export type ConversationSummary = Pick<Conversation, "id" | "title" | "projectKeys"> & {
  updatedAt: string;
  /** The thread's last message, cut short — where it stopped. Absent on
   *  rows from before the rail showed it. */
  preview?: string;
  /** The last message's shape, so the rail can say what the thread needs
   *  (lib/loki/thread-state.ts). Absent on a row the client made itself. */
  lastRole?: string | null;
  lastKind?: string | null;
  lastAt?: string | null;
  lastOk?: boolean | null;
  lastOutcome?: string | null;
  lastNeedsProject?: boolean | null;
  lastReadAt?: string | null;
  pinnedAt?: string | null;
};

/** A transcript message as it arrives over the wire (createdAt is an ISO
 *  string; meta is opaque). */
export type LokiMessage = Omit<ConversationMessage, "createdAt" | "meta"> & {
  createdAt: string;
  meta: Record<string, unknown> | null;
  /** What this session watched the turn do — how long, and its steps — for
   *  the "Thought for 42s ›" row. Only the turn answered in this session
   *  carries it; a reopened thread has the work trail (meta) instead. */
  thinking?: Thinking;
};

/** GET /api/user-projects row (subset Loki needs). topGoal is the project's
 *  current active goal — what the fleet is aiming at — shown in the panel so
 *  the operator can aim a dispatch at a glance. */
export type LokiProject = {
  id: string;
  name: string;
  /** Entity project id — the key the /api/projects/[id]/* routes use (brief, etc.). */
  entityProjectId?: string | null;
  topGoal?: { title: string; progress: number | null } | null;
};

/** GET /api/agents row — a dispatchable agent and the models it can run, for
 *  the composer model picker. */
export type LokiAgent = {
  id: string;
  label: string;
  defaultModel: string;
  modelSuggestions: string[];
};

/** A composer model-picker selection. Empty object = "Auto" (project default). */
export type ModelChoice = { agent?: string; model?: string };

/** A composer attachment — text inline or image (vision-described server-side). */
export type { Attachment, StagedAttachment } from "@/lib/loki/attachments";
