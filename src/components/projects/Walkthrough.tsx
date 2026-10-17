"use client";

/**
 * The engineer's account of a shipped change, on the page where the owner
 * watched it ship: what was wrong, what changed, why this way, what else was
 * considered, who it helps, what it costs, how we know it works, what was
 * left for later. The agent writes it into the pull request
 * (lib/feedback/fix-note — the same fields, so the two cannot drift); the fix
 * ledger reads it; this draws it.
 *
 * "Just like the engineer that was given the project tells you what they
 * have done, why, what the difference is, and how it will impact users as
 * well as us as an organisation" (owner, 2026-10-17). Agent text is shown as
 * text, never markup.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_NONE, WALKTHROUGH_LABELS as L, type FixNote } from "@/lib/feedback/fix-note";

const SHOWS_WORD: Record<NonNullable<FixNote["shows"]>, string> = {
  page: "You can see it on the page.",
  behind: "It works behind the scenes — nothing to see, but it is there.",
};

function Row({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  const none = text.trim().toLowerCase() === NOTE_NONE.toLowerCase();
  return (
    <div className="ui-walk-row">
      <dt className="ui-walk-label">{label}</dt>
      <dd className={cn("ui-walk-text", none && "text-text-muted")}>
        {none ? "None — checked." : text}
      </dd>
    </div>
  );
}

export function Walkthrough({ note, liveUrl }: { note: FixNote; liveUrl: string | null }) {
  const [more, setMore] = useState(false);
  const hasMore = Boolean(
    note.why ||
    note.considered.length ||
    note.us ||
    note.downsides ||
    note.costs ||
    note.proof ||
    note.next ||
    note.detail,
  );
  return (
    <section className="ui-walk" aria-labelledby="walkthrough-title">
      <h3 id="walkthrough-title" className="ui-walk-title">
        What changed, and why
      </h3>
      <dl className="ui-walk-list">
        <Row label={L.problem} text={note.problem} />
        <Row label={L.change} text={note.change} />
        {note.shows && (
          <div className="ui-walk-row">
            <dt className="ui-walk-label">Where</dt>
            <dd className="ui-walk-text">
              {SHOWS_WORD[note.shows]}
              {note.where && <> {note.where}</>}
              {liveUrl && note.shows === "page" && (
                <>
                  {" "}
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Open the page
                  </a>
                </>
              )}
            </dd>
          </div>
        )}
        <Row label={L.helps} text={note.helps} />
        {more && (
          <>
            <Row label={L.detail} text={note.detail} />
            <Row label={L.why} text={note.why} />
            {note.considered.length > 0 && (
              <div className="ui-walk-row">
                <dt className="ui-walk-label">{L.considered}</dt>
                <dd className="ui-walk-text">
                  <ul className="list-disc space-y-1 pl-4">
                    {note.considered.map((c, i) => (
                      <li key={`${c.option}-${i}`}>
                        {c.option}
                        {c.whyNot && <span className="text-text-secondary"> — {c.whyNot}</span>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <Row label={L.us} text={note.us} />
            <Row label={L.downsides} text={note.downsides} />
            <Row label={L.costs} text={note.costs} />
            <Row label={L.proof} text={note.proof} />
            <Row label={L.next} text={note.next} />
          </>
        )}
      </dl>
      {hasMore && (
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="ui-chat-link"
          aria-expanded={more}
        >
          {more ? "Less" : "The full account — why, trade-offs, costs, proof"}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      )}
    </section>
  );
}
