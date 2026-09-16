"use client";

import { useCallback, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { useLokiStream } from "@/hooks/use-loki-stream";
import { cn } from "@/lib/utils";
import type { WireMessage } from "@/lib/loki/stream";

export type RailComposerMode = "ask" | "inject";

/**
 * Ask Loki vs Inject into the same Terminal session.
 *
 * Ask is chat-only (no dispatch classifier). Inject is tab-inject into the
 * attached PTY — same session Watch is following.
 */
export function TerminalLokiComposer({
  project,
  tab,
  onInjected,
  onComment,
}: {
  project: string;
  tab: string | null;
  onInjected: (ack: { commandId: string | null; runId: string | null }) => void;
  onComment: (text: string) => void;
}) {
  const [mode, setMode] = useState<RailComposerMode>("inject");
  const [text, setText] = useState("");
  const [sendingInject, setSendingInject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const stream = useLokiStream({
    onMessage: (message: WireMessage) => {
      if (message.role === "assistant" && message.content) onComment(message.content);
    },
  });

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    const res = await postJson("/api/conversations", { projectKeys: [project] });
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

  const sendAsk = async () => {
    const prompt = text.trim();
    if (!prompt || stream.sending) return;
    setError(null);
    const convoId = await ensureConversation();
    if (!convoId) return;
    setText("");
    await stream.send(`/api/conversations/${convoId}/messages`, {
      text: prompt,
      selectedProjects: [project],
      chatOnly: true,
    });
  };

  const sendInject = async () => {
    const prompt = text.trim();
    if (!prompt || sendingInject) return;
    if (!tab) {
      setError("Open a session first — inject writes into the attached PTY.");
      return;
    }
    setSendingInject(true);
    setError(null);
    try {
      const res = await postJson("/api/control/tab-inject", { tab, prompt });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        blocked?: boolean;
        commandId?: string;
        runId?: string;
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not inject.");
        return;
      }
      if (data.blocked) {
        setError(`Not sent — someone is typing in “${tab}” right now.`);
        return;
      }
      setText("");
      onInjected({
        commandId: typeof data.commandId === "string" ? data.commandId : null,
        runId: typeof data.runId === "string" ? data.runId : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not inject.");
    } finally {
      setSendingInject(false);
    }
  };

  const sending = mode === "ask" ? stream.sending : sendingInject;
  const placeholder =
    mode === "ask"
      ? `Ask Loki about ${project}…`
      : tab
        ? `Inject into ${tab}…`
        : "Open a session to inject";

  return (
    <div className="ui-term-loki-composer">
      <div className="flex gap-1">
        <button
          type="button"
          className={mode === "ask" ? "ui-chip-toggle-compact-active" : "ui-chip-toggle-compact"}
          aria-pressed={mode === "ask"}
          onClick={() => setMode("ask")}
        >
          Ask
        </button>
        <button
          type="button"
          className={mode === "inject" ? "ui-chip-toggle-compact-active" : "ui-chip-toggle-compact"}
          aria-pressed={mode === "inject"}
          onClick={() => setMode("inject")}
        >
          Inject
        </button>
      </div>
      {(error || stream.error) && <p className="ui-error text-micro">{error ?? stream.error}</p>}
      {stream.live?.preview && (
        <p className="text-micro text-text-secondary">{stream.live.preview}</p>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void (mode === "ask" ? sendAsk() : sendInject());
            }
          }}
          placeholder={placeholder}
          aria-label={mode === "ask" ? `Ask Loki about ${project}` : `Inject into ${project}`}
          className="ui-input-compact min-h-11 flex-1 resize-none"
        />
        <button
          type="button"
          className={cn("ui-btn-icon shrink-0", sending && "opacity-70")}
          disabled={!text.trim() || sending || (mode === "inject" && !tab)}
          onClick={() => void (mode === "ask" ? sendAsk() : sendInject())}
        >
          {sending ? <Loader2 className="ui-spinner-sm" /> : <Send className="h-3.5 w-3.5" />}
          <span className="sr-only">{mode === "ask" ? "Send Ask" : "Send Inject"}</span>
        </button>
      </div>
    </div>
  );
}
