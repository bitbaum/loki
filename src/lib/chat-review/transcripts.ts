import type { AnswerFeedback, ChatTranscript, ChatTranscriptTurn } from "@bitbaum/chatkit";
import { FEEDBACK_REASONS } from "@bitbaum/chatkit";
import { REVIEW_EXPORT_MAX_CHARS, REVIEW_EXPORT_MAX_TURNS } from "@/config/chat-review";
import { readWork } from "@/lib/loki/work";

/**
 * Loki's conversations in chatkit's `ChatTranscript` shape, for the nightly
 * review. Pure: rows in, transcripts out, no names and no user ids — the ids
 * are Loki's own and the judge never needs more. Pinned by
 * scripts/test/chat-review.ts.
 */

export type ReviewMessageRow = {
  id: string;
  role: string;
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: Date;
};
export type ReviewFeedbackRow = {
  messageId: string;
  verdict: string;
  reason: string | null;
  text: string | null;
};

/** Where this conversation happened: Loki's chat, scoped to a project when it was. */
export function reviewSurface(projectKeys: readonly string[]): string {
  return projectKeys.length > 0 ? `/loki?project=${projectKeys[0]}` : "/loki";
}

/** What the assistant did on the way to the answer, as the trail says it. */
export function stepsFrom(meta: Record<string, unknown> | null): string[] | undefined {
  const steps = readWork(meta).map((s) =>
    s.kind === "note"
      ? s.text.trim()
      : `${s.name}${s.detail ? ` ${s.detail}` : ""}${s.phase === "fail" ? " (failed)" : ""}`,
  );
  return steps.length ? steps : undefined;
}

/** A dispatch that failed, or a turn the stream closed without an answer. */
export function turnFailed(meta: Record<string, unknown> | null): boolean {
  return meta?.ok === false || meta?.outcome === "failed";
}

export function toTranscript(input: {
  id: string;
  updatedAt: Date;
  projectKeys: readonly string[];
  messages: readonly ReviewMessageRow[];
  feedback: readonly ReviewFeedbackRow[];
}): ChatTranscript {
  // The last turns, in order: a long thread's start is context the judge
  // does not need, and the cap is the export's contract.
  const turns: ChatTranscriptTurn[] = input.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-REVIEW_EXPORT_MAX_TURNS)
    .map((m) => {
      const turn: ChatTranscriptTurn = {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content.slice(0, REVIEW_EXPORT_MAX_CHARS),
      };
      if (m.role === "assistant") {
        const steps = stepsFrom(m.meta);
        if (steps) turn.steps = steps;
        if (turnFailed(m.meta)) turn.failed = true;
      }
      return turn;
    });
  const kept = new Set(turns.map((t) => t.id));
  const reasons = new Set<string>(FEEDBACK_REASONS);
  const feedback: AnswerFeedback[] = input.feedback
    .filter((f) => kept.has(f.messageId) && (f.verdict === "up" || f.verdict === "down"))
    .map((f) => ({
      messageId: f.messageId,
      verdict: f.verdict as "up" | "down",
      ...(f.reason && reasons.has(f.reason)
        ? { reason: f.reason as AnswerFeedback["reason"] }
        : {}),
      ...(f.text ? { text: f.text.slice(0, 1000) } : {}),
    }));
  return {
    id: input.id,
    at: input.updatedAt.toISOString(),
    surface: reviewSurface(input.projectKeys),
    turns,
    ...(feedback.length ? { feedback } : {}),
  };
}
