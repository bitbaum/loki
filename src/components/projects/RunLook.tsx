"use client";

/**
 * What Loki saw once a change was live: the page before and after, side by
 * side, with the evidence it read as the caption — the same block under a
 * chat dispatch card and on Watch, so the two screens show one result. The
 * verdict in words is the track's live row; this is the proof under it. The pictures are owner-only API images (run-handoff
 * `runPicturePath`), so they are plain <img>s: next/image would fetch them
 * without the session.
 *
 * The track above it already says "Live on <site>" with Loki's one-line
 * note; this is the proof under it. Nothing here decides — a missing
 * picture is simply not drawn.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { RunFollow } from "@/lib/run-handoff";

export function RunLook({ follow }: { follow: RunFollow }) {
  const [open, setOpen] = useState(false);
  const after = follow.pictureUrl;
  const before = follow.beforePictureUrl;
  // The verdict in words is the track's live row; this block is the proof.
  if (!after && !before) return null;
  const pair = Boolean(before && after);
  return (
    <div className="ui-run-look">
      {
        <figure className={cn("ui-fb-looked", open && "ui-fb-looked-open")}>
          <div className={cn("ui-fb-looked-pair", pair && "ui-fb-looked-pair-two")}>
            {before && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="ui-fb-looked-btn"
                aria-expanded={open}
                title={open ? "Show less" : "Show the whole picture"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- owner-only API image */}
                <img src={before} alt="The page before the change, on a phone" loading="lazy" />
                <span className="ui-fb-looked-tag">Before</span>
              </button>
            )}
            {after && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="ui-fb-looked-btn"
                aria-expanded={open}
                title={open ? "Show less" : "Show the whole picture"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- owner-only API image */}
                <img src={after} alt="The live page as Loki saw it, on a phone" loading="lazy" />
                {pair && <span className="ui-fb-looked-tag">After</span>}
              </button>
            )}
          </div>
          <figcaption className="ui-fb-looked-cap">
            {pair
              ? "Before and after, on a phone"
              : after
                ? "The live page, as Loki saw it on a phone"
                : "The page before the change, on a phone"}
            {follow.looked?.evidence ? ` · ${follow.looked.evidence}` : ""}
            {!open && " · open it to see all of it"}
          </figcaption>
        </figure>
      }
    </div>
  );
}
