"use client";

import { useState } from "react";
import { Globe, Loader2, Sparkles } from "lucide-react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { trackUsage } from "@/lib/usage/track";

/** The walk worth watching: every reachable page, on phone and desktop. */
const TRY_MODE = "visual";

/**
 * The site before Loki has looked at it: its address, and the one thing
 * worth doing first — let Loki try it, and watch. That walk is the moment
 * the workbench is for (RobotBrowser); until someone starts one, a new
 * person never learns it exists. Opening the site yourself stays one tap
 * beside it. A walk that cannot start says why in a sentence, with no
 * code in it.
 */
export function WorkbenchSiteStart({
  projectId,
  host,
  starting,
  onStarted,
  onOpenSite,
}: {
  projectId: string;
  host: string;
  /** A walk was asked for and Loki's browser is not on screen yet:
   *  "queued" while no builder has picked it up, "opening" once one has. */
  starting: "queued" | "opening" | null;
  onStarted: () => void;
  onOpenSite: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tryIt = async () => {
    trackUsage({ surface: "projects.workbench", action: "tap", target: "try-it" });
    setBusy(true);
    setError(null);
    try {
      const response = await postJson(`/api/projects/${projectId}/reviews`, {
        mode: TRY_MODE,
        paths: [],
      });
      if (!response.ok) await throwApiError(response, "Loki could not start just now.");
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Loki could not start just now.");
    } finally {
      setBusy(false);
    }
  };

  // Say only what is true: waiting in line is not opening.
  if (starting || busy)
    return (
      <div className="ui-workbench-site-rest" role="status">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="text-text-primary">
          {starting === "opening" ? `Loki is opening ${host}…` : "Waiting for Loki's builder…"}
        </span>
        <span>It shows up here the moment it starts.</span>
      </div>
    );

  return (
    <div className="ui-workbench-site-rest">
      <Globe className="h-7 w-7" aria-hidden="true" />
      <span className="text-text-primary">{host}</span>
      <span>Watch Loki use it, the way a visitor would.</span>
      <button type="button" className="ui-btn-primary mt-2 gap-1.5" onClick={() => void tryIt()}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Let Loki try it
      </button>
      <button type="button" className="ui-link text-sm" onClick={onOpenSite}>
        Or open it yourself
      </button>
      {error && (
        <p className="mb-0 max-w-sm text-center text-sm text-status-negative" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
