"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson } from "@/lib/api/fetch";
import { awayDuration, type AwayLine, type AwayStatus, type AwaySummary } from "@/lib/away-rules";

type AwayResponse = {
  status: AwayStatus;
  summary?: AwaySummary;
  lines?: AwayLine[];
};

/**
 * The first thing on screen when the operator comes back from a "back in
 * 30 minutes": what moved, what is live, what still runs, what needs them —
 * each line a link to where it is acted on. One tap and it is gone. While
 * they are still away it is one quiet line, so a glance at the phone says
 * the fleet knows.
 *
 * Mounted on Control (the operator loop's front door) and on the chat's
 * start screen (where the absence was announced). Renders nothing when
 * nobody said they were leaving.
 */
export function AwayReturnCard() {
  const { data, refetch } = useFetch<AwayResponse>("/api/away");
  const [gone, setGone] = useState(false);
  if (!data || gone) return null;
  const { status } = data;
  if (status.state === "none") return null;

  const dismiss = async () => {
    setGone(true);
    await deleteJson("/api/away").catch(() => {});
    refetch();
  };

  if (status.state === "away") {
    const until = new Date(status.until).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <p className="ui-away-line">
        <span>Away until {until} — the summary is ready when you are.</span>
        <button type="button" className="ui-link-muted" onClick={dismiss}>
          I&apos;m back
        </button>
      </p>
    );
  }

  const minutes = data.summary?.minutes ?? 0;
  const lines = data.lines ?? [];
  return (
    <section className="ui-away" aria-label="While you were away">
      <div className="ui-away-head">
        <p className="ui-away-title">While you were away · {awayDuration(minutes)}</p>
        <button type="button" className="ui-btn-icon" onClick={dismiss} aria-label="Got it">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="ui-away-lines">
        {lines.map((l) => (
          <li key={l.text}>
            <Link href={l.href} className="ui-away-row" onClick={() => void dismiss()}>
              <span className="min-w-0 flex-1">{l.text}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
