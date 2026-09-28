"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
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
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className={cn("ui-btn-save gap-1", size === "sm" && "ui-btn-sm")}
      title="Open the live page and watch Loki walk you through the change"
    >
      {busy ? <Loader2 className="ui-spinner-xs" /> : <Play className="h-3 w-3" />}
      Watch the fix
    </button>
  );
}
