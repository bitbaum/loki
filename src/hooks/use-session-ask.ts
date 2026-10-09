"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessageData } from "@bitbaum/chatkit/react";
import { postJson } from "@/lib/api/fetch";
import type { Attachment, ModelChoice } from "@/components/loki/types";
import { useLokiStream, type UseLokiStream } from "@/hooks/use-loki-stream";
import type { WireMessage } from "@/lib/loki/stream";
import { citationsFrom } from "@/components/loki/footers";
import { readReplies } from "@/lib/loki/replies";

export type SessionAsk = {
  /** The thread so far, in chatkit's shape — rendered by ChatThread. */
  messages: ChatMessageData[];
  live: UseLokiStream["live"];
  sending: boolean;
  stopped: boolean;
  error: string | null;
  /**
   * Send one Ask turn. `shown` is what the thread displays as the person's
   * message when the sent text is an instruction they did not type (a summary
   * request). Resolves false when nothing was sent, so a draft can be kept.
   */
  ask: (
    text: string,
    opts?: { choice?: ModelChoice; attachments?: Attachment[]; shown?: string },
  ) => Promise<boolean>;
  /**
   * Send a suggested reply the person tapped: the same turn the composer
   * sends, on the model they last chose, so a tap is never a quieter version
   * of typing the words.
   */
  reply: (text: string) => Promise<boolean>;
  stop: () => void;
  clearError: () => void;
};

/**
 * Ask Loki about a project, as a thread. Chat-only: nothing reaches the session.
 *
 * Lifted out of TerminalComposer so the panel that SHOWS the conversation owns
 * it. The composer used to keep the thread and hand the panel only its latest
 * answer — earlier turns vanished, and nothing else (the summary button) could
 * ask on the same thread.
 */
export function useSessionAsk(project: string | null): SessionAsk {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stream = useLokiStream({
    onMessage: (message: WireMessage) => {
      if (message.role !== "assistant" || !message.content) return;
      setMessages((all) => [
        ...all,
        // The sources travel with the answer. Without them chatkit drops each
        // [F1] marker and keeps the space before it, so the rail printed
        // "queued waiting for pickup ." — a citation turned into a typo.
        {
          id: message.id,
          role: "assistant",
          content: message.content,
          citations: citationsFrom(message.meta),
          // Stored apart from the text by the messages route; chatkit's
          // thread shows them under the latest answer.
          replies: readReplies(message.meta),
        },
      ]);
    },
  });

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    const res = await postJson("/api/conversations", { projectKeys: project ? [project] : [] });
    const body = (await res.json().catch(() => ({}))) as {
      conversation?: { id?: string };
      error?: string;
    };
    if (!res.ok || typeof body.conversation?.id !== "string") {
      setError(body.error ?? "Could not open a Loki thread.");
      return null;
    }
    setConversationId(body.conversation.id);
    return body.conversation.id;
  }, [conversationId, project]);

  const lastChoice = useRef<ModelChoice | undefined>(undefined);

  const ask: SessionAsk["ask"] = async (text, opts = {}) => {
    if (opts.choice) lastChoice.current = opts.choice;
    setError(null);
    const convoId = await ensureConversation();
    if (!convoId) return false;
    const attachments = opts.attachments ?? [];
    setMessages((all) => [
      ...all,
      { id: `local-${Date.now()}`, role: "user", content: opts.shown ?? text },
    ]);
    // Not awaited: the draft clears as soon as the thread exists; the answer
    // streams into the thread.
    void stream.send(`/api/conversations/${convoId}/messages`, {
      text,
      selectedProjects: project ? [project] : [],
      chatOnly: true,
      ...(opts.choice?.model ? { model: opts.choice.model } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    return true;
  };

  return {
    messages,
    live: stream.live,
    sending: stream.sending,
    stopped: stream.stopped,
    error: error ?? stream.error,
    ask,
    reply: (text) => ask(text, { choice: lastChoice.current }),
    stop: stream.stop,
    clearError: () => {
      setError(null);
      stream.clearError();
    },
  };
}
