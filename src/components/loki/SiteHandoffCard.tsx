"use client";

import { ExternalLink, X } from "lucide-react";
import {
  handoffSummary,
  handoffTurns,
  type HandoffTurn,
  type SiteHandoff,
} from "@/lib/loki/site-handoff";

const TURN_CLASS: Record<HandoffTurn["who"], string> = {
  you: "ui-loki-handoff-turn ui-loki-handoff-you",
  loki: "ui-loki-handoff-turn",
  noticed: "ui-loki-handoff-turn ui-loki-handoff-noticed",
  sent: "ui-loki-handoff-turn ui-loki-handoff-sent",
};

/** Turns shown before "earlier …" — the end is what they came to go on with. */
const TURNS_SHOWN = 4;

/**
 * The conversation carried in from the owner's site, shown where a thread
 * would be: who said what, the newest last, in the thread's own type — so it
 * reads as the start of THIS conversation, which is what it is. It used to be
 * pasted into the composer as raw "Me: … / Loki: …" text.
 */
export function SiteHandoffCard({
  handoff,
  onDismiss,
}: {
  handoff: SiteHandoff;
  onDismiss: () => void;
}) {
  const turns = handoffTurns(handoff);
  const shown = turns.slice(-TURNS_SHOWN);
  const earlier = turns.length - shown.length;
  return (
    <section className="ui-loki-handoff" aria-label="Conversation from your site">
      <header className="ui-loki-handoff-head">
        <span className="ui-kicker shrink-0 whitespace-nowrap">From your site</span>
        {handoff.url ? (
          <a
            href={handoff.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-loki-handoff-source"
          >
            {handoffSummary(handoff)}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span className="ui-loki-handoff-source">{handoffSummary(handoff)}</span>
        )}
        <button
          type="button"
          className="ui-loki-handoff-x"
          onClick={onDismiss}
          aria-label="Start without it"
          title="Start without it"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      {earlier > 0 && (
        <p className="ui-loki-handoff-earlier">
          {earlier} earlier {earlier === 1 ? "message" : "messages"} go along too
        </p>
      )}
      <ol className="ui-loki-handoff-turns">
        {shown.map((t, i) => (
          <li key={i} className={TURN_CLASS[t.who]}>
            {t.who === "noticed" && <span className="ui-loki-handoff-who">Loki noticed</span>}
            {t.who === "sent" && <span className="ui-loki-handoff-who">Sent to the builder</span>}
            <span className="whitespace-pre-line">{t.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
