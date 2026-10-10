"use client";

import { useState } from "react";
import { Check, Loader2, Play, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { tourSiteUrl } from "../../../widget/tour";

/**
 * "Watch the fix": open the live page with a walkthrough of the change —
 * a cursor moves to each part, a caption says why, a safe control is clicked.
 * The old control here was "Check live", a bare link to the site, and a green
 * "Live" badge that was ALSO that link — which read as "watch it live" and
 * delivered a homepage with no idea where to look (2026-09-28).
 *
 * The tab is opened synchronously on the click (a popup blocker allows that)
 * and pointed at the tour once the ticket arrives; if that fails the plain
 * page still opens, so the button is never a dead end.
 */
export function WatchFixButton({
  feedbackId,
  liveHref,
  size = "md",
}: {
  feedbackId: string;
  liveHref: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const tab = window.open("", "_blank");
    // The site must not be able to steer this Loki tab.
    if (tab) tab.opener = null;
    setBusy(true);
    let url = liveHref;
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/tour`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { token?: string };
      if (res.ok && body.token) url = tourSiteUrl(liveHref, body.token);
    } catch {
      /* the plain page is still worth opening */
    } finally {
      setBusy(false);
    }
    if (tab) tab.location.href = url;
    else window.location.href = url;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className={cn("ui-btn-save gap-1", size === "sm" && "ui-btn-sm")}
        title="Opens the live page in a new tab; Loki points at each part of the change and says why"
      >
        {busy ? <Loader2 className="ui-spinner-xs" /> : <Play className="h-3 w-3" />}
        See the fix on the site
      </button>
      <ShareWatchButton feedbackId={feedbackId} size={size} />
    </>
  );
}

/**
 * Share the walkthrough: a link anyone can open to watch the same change on
 * the live site, in plain words (app/w/[token]). The phone's share sheet when
 * there is one, else the clipboard — and the button says which happened.
 */
function ShareWatchButton({ feedbackId, size }: { feedbackId: string; size: "sm" | "md" }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");

  const share = async () => {
    setState("busy");
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/share`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !body.url) throw new Error("no link");
      if (navigator.share) {
        try {
          await navigator.share({ title: "Watch the fix", url: body.url });
          setState("idle");
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return setState("idle");
        }
      }
      await navigator.clipboard.writeText(body.url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };

  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={state === "busy"}
      className={cn("ui-btn-secondary gap-1", size === "sm" && "ui-btn-sm")}
      title="A link anyone can open to see this change walked through on the live site"
    >
      {state === "busy" ? (
        <Loader2 className="ui-spinner-xs" />
      ) : state === "copied" ? (
        <Check className="h-3 w-3" />
      ) : (
        <Share2 className="h-3 w-3" />
      )}
      {state === "copied"
        ? "Link copied"
        : state === "failed"
          ? "Couldn't share"
          : "Share the walkthrough"}
    </button>
  );
}
