"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { RobotBrowser } from "@/components/inspection/RobotBrowser";
import { RobotEnding } from "@/components/inspection/RobotEnding";
import { useFetch } from "@/hooks/use-fetch";
import { WORKBENCH_POLL_MS } from "@/config/workbench";
import { WorkbenchFrame } from "./WorkbenchFrame";
import { WorkbenchSiteStart } from "./WorkbenchSiteStart";
import { REVIEW_WALKING, type WorkbenchReview, type WorkbenchSite } from "./workbench-types";

/** While Loki rests, ask now and then whether a new walk began. */
const RESTING_POLL_MS = 20_000;

/**
 * The site, as Loki's browser sees it.
 *
 * Every fleet site forbids being framed, so the site cannot be shown live
 * inside Loki — but Loki's OWN browser on the box can be: the review worker
 * walks the site, presses, and keeps a frame per step with the step named
 * and, for a press, where it lands (lib/inspection). While it walks, you
 * watch it: its pointer glides to each press and the view leans in to keep
 * it readable (RobotBrowser). When it finishes while you watch, it says so
 * warmly, and what it found (RobotEnding). At rest, its last look. A tap
 * opens the real site in its own window, where you use it yourself and the
 * widget does the watching. Before Loki has looked at all, it offers the
 * walk itself — "Let Loki try it" (WorkbenchSiteStart).
 *
 * It follows the project's LATEST review, so a walk started after this
 * page opened appears here too: briskly while walking, now and then at rest.
 */
export function WorkbenchSiteView({
  projectId,
  site,
  initialReview,
  onOpenSite,
}: {
  projectId: string;
  site: WorkbenchSite | null;
  initialReview: WorkbenchReview | null;
  onOpenSite: () => void;
}) {
  const [walkingSeen, setWalkingSeen] = useState(
    initialReview ? REVIEW_WALKING.has(initialReview.status) : false,
  );
  const { data, refetch } = useFetch<{ review: WorkbenchReview | null }>(
    site ? `/api/projects/${encodeURIComponent(projectId)}/reviews` : null,
    { intervalMs: walkingSeen ? WORKBENCH_POLL_MS : RESTING_POLL_MS },
  );
  const review = data ? data.review : initialReview;
  const walking = review ? REVIEW_WALKING.has(review.status) : false;
  // A walk that ends while someone watches earns an ending; one that ended
  // before they came is simply the last look.
  const [endedWhileWatching, setEnded] = useState<string | null>(null);
  if (walking !== walkingSeen) {
    setWalkingSeen(walking);
    if (!walking && review?.status === "finished") setEnded(review.id);
  }
  const frame = review?.frame ?? null;
  const reviewHref = `/projects/${encodeURIComponent(projectId)}/review`;

  if (!site)
    return (
      <WorkbenchFrame label="The site" title="No site yet">
        <div className="ui-workbench-site-rest">
          <Globe className="h-7 w-7" aria-hidden="true" />
          <span>It appears here once one is live.</span>
        </div>
      </WorkbenchFrame>
    );

  const host = hostOf(site.url);
  const doing = frame
    ? walking
      ? frame.action || `Loki is on ${pathOf(frame.url)}`
      : `Loki's last look: ${pathOf(frame.url)}`
    : site.kind === "preview"
      ? "Preview"
      : "Live";
  return (
    <WorkbenchFrame
      label="The site"
      tone={walking ? "positive" : "neutral"}
      title={
        <>
          <span className="text-text-primary">{host}</span>
          <span className="text-text-muted" aria-live="polite">
            {" "}
            · {doing}
          </span>
        </>
      }
      aside={
        <Link href={reviewHref} className="ui-link shrink-0 text-sm">
          {walking ? "Follow" : "Review it"}
        </Link>
      }
    >
      <div className="relative flex min-h-0 flex-1">
        {frame ? (
          <RobotBrowser
            frame={frame}
            live={walking}
            fit="contain"
            onOpen={onOpenSite}
            label={`Loki's browser on ${host}`}
          />
        ) : (
          <WorkbenchSiteStart
            projectId={projectId}
            host={host}
            starting={walking ? (review?.status === "queued" ? "queued" : "opening") : null}
            onStarted={() => {
              setWalkingSeen(true);
              refetch();
            }}
            onOpenSite={onOpenSite}
          />
        )}
        {review && endedWhileWatching === review.id && (
          <RobotEnding
            coverage={review.coverage}
            findings={review.findingCount}
            reviewHref={reviewHref}
            onClose={() => setEnded(null)}
          />
        )}
      </div>
    </WorkbenchFrame>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "the front page" : u.pathname;
  } catch {
    return url;
  }
}
