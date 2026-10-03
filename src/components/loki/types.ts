import type { Conversation, ConversationMessage } from "@/db/schema/conversations";

/** Left-pane row — the subset listConversations() returns (dates arrive as
 *  ISO strings over the wire). */
export type ConversationSummary = Pick<Conversation, "id" | "title" | "projectKeys"> & {
  updatedAt: string;
  /** The thread's last message, cut short — where it stopped. Absent on
   *  rows from before the rail showed it. */
  preview?: string;
};

/** A transcript message as it arrives over the wire (createdAt is an ISO
 *  string; meta is opaque). */
export type LokiMessage = Omit<ConversationMessage, "createdAt" | "meta"> & {
  createdAt: string;
  meta: Record<string, unknown> | null;
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
