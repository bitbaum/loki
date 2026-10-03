"use client";

import { useEffect, useState } from "react";
import { CornerDownRight } from "lucide-react";

/**
 * Suggested next steps under the newest answer — the first is Loki's
 * recommendation, the others alternatives; a tap sends one as your
 * next message. Fetched once per answer (keyed by its id) and shown only when
 * the model had something specific to offer — no placeholder rows, no
 * spinner: suggestions are a nicety, and a loading state for a nicety is
 * noise under the thing you are actually reading.
 */
export function FollowUps({
  answerId,
  question,
  answer,
  onPick,
}: {
  answerId: string;
  question: string;
  answer: string;
  onPick: (text: string) => void;
}) {
  const [result, setResult] = useState<{ id: string; items: string[] } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/loki/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { suggestions?: string[] } | null) =>
        setResult({ id: answerId, items: body?.suggestions ?? [] }),
      )
      .catch(() => {
        /* aborted, or offline — no suggestions is a fine answer */
      });
    return () => ctrl.abort();
    // The answer's id is the identity; its text only changes with the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerId]);

  const items = result?.id === answerId ? result.items : [];
  if (items.length === 0) return null;
  return (
    <ul className="ui-loki-followups" aria-label="Suggested follow-ups">
      {items.map((text, i) => (
        <li key={text}>
          {/* The first is the recommendation (see lib/loki/follow-ups.ts), so
              "what do I do next?" always has an answer under the answer. */}
          <button
            type="button"
            className={i === 0 ? "ui-loki-followup ui-loki-followup-next" : "ui-loki-followup"}
            onClick={() => onPick(text)}
          >
            <CornerDownRight className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              {i === 0 && <span className="ui-loki-followup-tag">Next</span>}
              {text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
