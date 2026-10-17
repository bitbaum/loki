"use client";

/**
 * The reporter's walk, as the owner reads it: each moment on its own line —
 * when, which part of the page, what they tapped, what was on screen, what
 * they said — and, on a tap, the picture Loki takes of that very view
 * (/api/feedback/[id]/moment/[n]). Said → seen, in order, so "this button is
 * wrong" has a button beside it.
 */
import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { momentClock, type ReportMoment } from "../../../widget/moments-contract";

export function MomentsWalk({
  feedbackId,
  moments,
  canLook,
}: {
  feedbackId: string;
  moments: ReportMoment[];
  /** Owner or editor: may ask Loki to take the picture of a moment. */
  canLook: boolean;
}) {
  const [pictures, setPictures] = useState<Record<number, string | "loading" | "failed">>({});
  if (!moments.length) return null;
  const look = (n: number) => {
    setPictures((p) => ({ ...p, [n]: "loading" }));
    fetch(`/api/feedback/${feedbackId}/moment/${n}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { picture?: string };
        setPictures((p) => ({ ...p, [n]: res.ok && body.picture ? body.picture : "failed" }));
      })
      .catch(() => setPictures((p) => ({ ...p, [n]: "failed" })));
  };
  const pages = new Set(moments.map((m) => m.page)).size;
  return (
    <ol className="ui-fb-walk" aria-label="What they saw while saying it">
      {moments.map((m, n) => {
        const picture = pictures[n];
        return (
          <li key={`${m.at}-${n}`} className="ui-fb-walk-item">
            <div className="ui-fb-walk-head">
              <span className="ui-fb-walk-time">{momentClock(m.at)}</span>
              <span className="ui-fb-walk-where">
                {pages > 1 && <span className="text-text-muted">{m.page} · </span>}
                {m.label}
                {m.marked && <span className="ui-fb-walk-marked"> marked</span>}
              </span>
            </div>
            {m.tap && (
              <p className="ui-fb-walk-seen">
                Tapped <span className="font-medium text-text-primary">“{m.tap.text}”</span>
              </p>
            )}
            {m.text && !m.tap && (
              <p className="ui-fb-walk-seen">
                On screen: <span className="text-text-secondary">“{m.text}”</span>
              </p>
            )}
            {m.said && <p className="ui-fb-walk-said">“{m.said}”</p>}
            {canLook &&
              (picture && picture !== "loading" && picture !== "failed" ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL from API
                <img
                  src={picture}
                  alt={`What they were looking at at ${momentClock(m.at)}, on a phone`}
                  className="ui-fb-walk-picture"
                  loading="lazy"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => look(n)}
                  disabled={picture === "loading"}
                  className="ui-fb-row-quiet-btn inline-flex items-center gap-1"
                >
                  {picture === "loading" ? (
                    <>
                      <Loader2 className="ui-spinner-xs" /> Loki is opening that view…
                    </>
                  ) : picture === "failed" ? (
                    "Could not take the picture — try again"
                  ) : (
                    <>
                      <Camera className="h-3.5 w-3.5" aria-hidden /> See what they saw
                    </>
                  )}
                </button>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
