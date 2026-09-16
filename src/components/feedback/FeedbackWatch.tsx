"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessagesSquare, SquareTerminal } from "lucide-react";

type WatchPayload = {
  work: {
    phase: string;
    label: string;
    stepSummary: string;
    queueReason: string | null;
    diagnostic: string | null;
    terminalReady: boolean;
  };
  events: { kind: string; label: string; at: string; detail: Record<string, unknown> | null }[];
  commandLive: { label: string; detail: string | null } | null;
  terminalHref: string;
  projectName: string;
};

/**
 * Progressive Watch on a feedback row: one human step, Terminal for the PTY,
 * dig-in for the run-event trail. Not a wall of agent text.
 *
 * `variant="button"` is the rail control; when open, render `<FeedbackWatchPanel/>`
 * under the row (full width).
 */
export function FeedbackWatchButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ui-btn-save gap-1"
      aria-expanded={open}
      onClick={onToggle}
      title="Show what the agent is doing"
    >
      Watch
    </button>
  );
}

export function FeedbackWatchPanel({
  feedbackId,
  fallbackTerminalHref,
  chatHref,
  stepSummary,
  queueReason,
  terminalReady,
}: {
  feedbackId: string;
  fallbackTerminalHref: string;
  /** Honest Loki chat deep link for this project — not a fake run-scoped chat. */
  chatHref: string;
  stepSummary?: string | null;
  queueReason?: string | null;
  terminalReady?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/watch`);
      const body = (await res.json().catch(() => ({}))) as WatchPayload & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not load progress");
        setData(null);
        return;
      }
      setData(body);
    } catch {
      setError("Could not load progress");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [feedbackId]);

  useEffect(() => {
    // Poll while the panel is mounted — same honesty interval as the inbox.
    // Defer the first load so we are not setState-sync inside the effect body
    // (react-hooks/set-state-in-effect).
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 8_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [load]);

  const summary = data?.work.stepSummary ?? stepSummary ?? "Checking progress…";
  const reason = data?.work.queueReason ?? queueReason ?? null;
  const termHref = data?.terminalHref ?? fallbackTerminalHref;
  const ready = data?.work.terminalReady ?? terminalReady === true;

  return (
    <div className="rounded-md border border-border-subtle bg-surface-secondary/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-primary">{summary}</p>
          {reason && <p className="mt-0.5 text-text-secondary">{reason}</p>}
          {data?.commandLive?.detail && data.commandLive.detail !== reason && (
            <p className="mt-0.5 text-text-tertiary">{data.commandLive.detail}</p>
          )}
          {!ready && (
            <p className="mt-1 text-text-muted">
              Terminal opens once a session exists — cold-start creates it when the cloud builder is
              online.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <a
            href={termHref}
            className="ui-btn-secondary gap-1"
            title={
              ready
                ? "Open the agent PTY"
                : "Open Terminal for this project (may be empty until a session exists)"
            }
          >
            <SquareTerminal className="h-3 w-3" /> Terminal
          </a>
          <a
            href={chatHref}
            className="ui-btn-secondary gap-1"
            title="Open Loki chat for this project — talk to the run there when the agent is in chat"
          >
            <MessagesSquare className="h-3 w-3" /> Chat
          </a>
        </div>
      </div>
      <p className="mt-1.5 text-micro text-text-muted">
        Watching on this row. Terminal and Chat are one tap away — you should not have to hunt.
      </p>
      {loading && !data && (
        <p className="mt-1 flex items-center gap-1 text-text-muted">
          <Loader2 className="ui-spinner-xs" /> Loading…
        </p>
      )}
      {error && <p className="mt-1 text-status-warning">{error}</p>}
      {data && data.events.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-micro text-text-muted hover:text-text-secondary">
            Event trail ({data.events.length})
          </summary>
          <ol className="mt-1 space-y-1 font-mono text-micro text-text-muted">
            {data.events.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`}>
                <span className="text-text-tertiary">{e.at.slice(11, 19)}</span> {e.label}
              </li>
            ))}
          </ol>
        </details>
      )}
      {data?.work.diagnostic && (
        <details className="mt-1">
          <summary className="cursor-pointer text-micro text-text-muted hover:text-text-secondary">
            Technical details
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-micro text-text-muted">
            {data.work.diagnostic}
          </p>
        </details>
      )}
    </div>
  );
}
