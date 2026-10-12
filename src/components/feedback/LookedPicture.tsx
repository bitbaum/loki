"use client";

import { useEffect, useState } from "react";
import { compactRelativeDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The picture Loki took of the live page to settle a shipped fix — shown
 * where the owner decides, so "It worked / Not fixed" can be answered from
 * the card instead of from a trip to the site. Loads on demand (the bytes
 * never ride the inbox list); a phone-sized crop first, the whole page on a
 * tap. If the verdict was read from this picture the caption says so.
 */
export function LookedPicture({
  feedbackId,
  verify,
  lead,
}: {
  feedbackId: string;
  verify: { at: string; via?: "text" | "picture"; picture?: boolean } | null | undefined;
  /** The card leads with it (taller crop); otherwise a row detail. */
  lead?: boolean;
}) {
  const [picture, setPicture] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const has = !!verify?.picture;
  useEffect(() => {
    if (!has) return;
    let gone = false;
    fetch(`/api/feedback/${feedbackId}/looked`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { picture?: string } | null) => {
        if (!gone && data?.picture) setPicture(data.picture);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [feedbackId, has]);
  if (!has || !picture || !verify) return null;
  const read =
    verify.via === "picture" ? "Loki read its verdict from this picture" : "Loki took this";
  return (
    <figure
      className={cn("ui-fb-looked", lead && "ui-fb-looked-lead", open && "ui-fb-looked-open")}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-fb-looked-btn"
        aria-expanded={open}
        title={open ? "Show less" : "Show the whole picture"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL from API */}
        <img src={picture} alt="The live page as Loki saw it, on a phone" loading="lazy" />
      </button>
      <figcaption className="ui-fb-looked-cap">
        What Loki saw · {read} · {compactRelativeDate(verify.at)}
        {!open && " · open it to see all of it"}
      </figcaption>
    </figure>
  );
}
