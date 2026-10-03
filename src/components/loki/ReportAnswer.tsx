"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";

type State =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; message: string };

/**
 * What a thumbs-down opens: one optional line on what was wrong, then Send.
 * The report lands in Loki's feedback inbox like any other (see
 * /api/loki/answer-feedback) — so the answer to "what happens to this?" is
 * on screen afterwards, with a link to where it can be followed.
 */
export function ReportAnswer({
  answer,
  question,
  onClose,
}: {
  answer: string;
  question: string | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>({ kind: "editing" });

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/loki/answer-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, question, note: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not file the report — try again.");
      setState({ kind: "sent" });
    } catch (e) {
      setState({
        kind: "failed",
        message: e instanceof Error ? e.message : "Could not file the report — try again.",
      });
    }
  };

  if (state.kind === "sent") {
    return (
      <p className="ui-loki-report-done" role="status">
        <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden />
        <span>
          Filed as feedback.{" "}
          <Link href="/my-feedback" className="ui-link-muted">
            Follow it
          </Link>
        </span>
      </p>
    );
  }

  return (
    <form
      className="ui-loki-report"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="ui-loki-report-label" htmlFor="loki-report-note">
        What was wrong with this answer? <span className="text-text-muted">(optional)</span>
      </label>
      <textarea
        id="loki-report-note"
        className="ui-input-compact min-h-16 w-full resize-y"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="e.g. it made up a meeting that isn't on my calendar"
        autoFocus
      />
      {state.kind === "failed" && <p className="ui-error">{state.message}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn-ghost ui-btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="ui-btn-primary ui-btn-sm"
          disabled={state.kind === "sending"}
        >
          {state.kind === "sending" && <Loader2 className="ui-spinner-xs" aria-hidden />}
          {state.kind === "failed" ? "Try again" : "Send report"}
        </button>
      </div>
    </form>
  );
}
