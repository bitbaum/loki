import Link from "next/link";
import { cn } from "@/lib/utils";
import type { OrchestrationOutcome } from "@/db/schema/orchestration-runs";
import { isFailingOutcome } from "@/lib/events";

const OUTCOME_GLYPH: Record<OrchestrationOutcome, string> = {
  success: "✓",
  partial: "~",
  error: "✗",
  hang: "✗",
  timeout: "✗",
  user_abort: "✕",
  // Its own glyph, not "✗": the run failed, but nothing about this PROJECT
  // did — the prompt never arrived. A streak of these is a delivery problem
  // wearing a project's name.
  unconfirmed: "⇥",
};

// Paired with the base `.ui-tag` class below — `.ui-tag-*` alone sets only
// color/background/border-COLOR custom properties, not the border WIDTH,
// radius or padding that make it read as a chip instead of a bare glyph.
// Every other place this same outcome data renders (ProjectDossierSections,
// project-card-helpers) pairs them; this one didn't, so on a phone "~" and
// "✗" rendered as unstyled floating characters next to the state pill —
// indistinguishable from a text-rendering glitch, exactly the "noise" a
// deliberate status widget must not look like.
const OUTCOME_TONE: Record<OrchestrationOutcome, string> = {
  success: "ui-tag ui-tag-positive",
  partial: "ui-tag ui-tag-warning",
  error: "ui-tag ui-tag-negative",
  hang: "ui-tag ui-tag-negative",
  timeout: "ui-tag ui-tag-negative",
  user_abort: "ui-tag ui-tag-warning",
  unconfirmed: "ui-tag ui-tag-warning",
};

const OUTCOME_LABEL: Record<OrchestrationOutcome, string> = {
  success: "succeeded",
  partial: "stopped part-way",
  error: "errored",
  hang: "hung",
  timeout: "timed out",
  user_abort: "aborted",
  unconfirmed: "never seen starting",
};

/**
 * How the last few agent runs went.
 *
 * It used to be five bare glyphs — `~ ~ ✗ ~ ~` — whose meaning existed only in
 * a `title` tooltip. On a phone there is no hover, so on the surface the fleet
 * is most often read from, the row was five coloured pills that told you
 * nothing and could not be asked. Worse, it sat directly beside the project
 * name, so the first thing a card said about a project was a cipher.
 *
 * The glyphs stay — dense, scannable, and genuinely useful once you know them —
 * but they are no longer the whole message. A plain-language summary states the
 * thing the glyphs encode, so the row is legible on first sight and precise on
 * second. When projectKey is given the whole thing links into Activity: a
 * failure signal must lead to its cause. Six unexplained, unclickable red ✗ was
 * the only honest surface during the 2026-07-02 dead-fleet incident, and it was
 * a dead end.
 */

/** The sentence the glyphs are encoding. Leads with the bad news when there is
 *  any, because that is the reason to look at all. */
function summarize(outcomes: OrchestrationOutcome[]): string {
  // isFailingOutcome, not a hand-copied list: this was the only remaining
  // second source of truth for which outcomes count as failures, so adding
  // `unconfirmed` to FAILING_OUTCOMES would have left this summary quietly
  // disagreeing with the brake and the ladder about the same runs.
  const failed = outcomes.filter((o) => isFailingOutcome(o)).length;
  const partial = outcomes.filter((o) => o === "partial").length;
  const n = outcomes.length;
  if (failed > 0) return `${failed} of last ${n} failed`;
  // "partial" is the database's word, not a person's. The summary already
  // earned its place by replacing bare glyphs with a sentence; saying "5 of
  // last 5 partial" only moves the cipher from a symbol to a term. What a
  // reader needs is what actually happened: the agent delivered something and
  // stopped before finishing.
  if (partial > 0) return `${partial} of last ${n} stopped part-way`;
  return n === 1 ? "last run clean" : `last ${n} clean`;
}
export function OutcomeStreak({
  outcomes,
  projectKey,
  className,
}: {
  outcomes: OrchestrationOutcome[];
  /** Control project key — enables the deep link into Activity. */
  projectKey?: string;
  className?: string;
}) {
  if (!outcomes || outcomes.length === 0) return null;

  const glyphs = outcomes.map((o, i) => (
    <span
      key={i}
      className={cn(OUTCOME_TONE[o], "min-w-5 px-1.5 py-0 text-center text-micro tracking-tight")}
      title={`${i === 0 ? "latest" : `${i + 1} runs ago`}: ${OUTCOME_LABEL[o]}`}
    >
      {OUTCOME_GLYPH[o]}
    </span>
  ));

  const summary = summarize(outcomes);
  const body = (
    <>
      <span className="flex items-center gap-1" aria-hidden="true">
        {glyphs}
      </span>
      <span className="ui-streak-summary">{summary}</span>
    </>
  );

  if (!projectKey) {
    return (
      <span className={cn("ui-streak", className)} aria-label={`Recent runs: ${summary}`}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={`/activity?window=week&project=${encodeURIComponent(projectKey)}`}
      className={cn("ui-streak ui-tap rounded transition-opacity hover:opacity-75", className)}
      aria-label={`Recent runs for ${projectKey}: ${summary} — open in Activity`}
      title="Recent run outcomes — open in Activity"
    >
      {body}
    </Link>
  );
}
