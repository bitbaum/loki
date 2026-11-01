"use client";

import { Globe } from "lucide-react";
import Link from "next/link";
import { useFetch } from "@/hooks/use-fetch";
import { WORKBENCH_POLL_MS } from "@/config/workbench";
import { WorkbenchFrame } from "./WorkbenchFrame";
import { REVIEW_WALKING, type WorkbenchReview, type WorkbenchSite } from "./workbench-types";

/* eslint-disable @next/next/no-img-element -- Loki's own browser evidence, already-encoded JPEG served by this app; it must not pass through a public image optimizer. */

/**
 * The site, as Loki's browser sees it.
 *
 * Every fleet site forbids being framed, so the site cannot be shown live
 * inside Loki — but Loki's OWN browser on the box can be: the review worker
 * walks the site, clicks, and keeps one frame per action with the action
 * named (lib/inspection). While it walks, this frame shows the walk, frame
 * by frame — the robot using the site, which no window of yours can show.
 * When it rests, it shows the last look it took. A tap on the picture opens
 * the real site in its own window, where you use it yourself and the widget
 * does the watching.
 *
 * The bar is the site's address and what Loki is doing there, like a
 * browser's own tab; the body is the page. With no look yet, the body is
 * the address alone, waiting for a tap — never a sentence apologising.
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
  const walkingAtStart = initialReview ? REVIEW_WALKING.has(initialReview.status) : false;
  const { data } = useFetch<{ review: WorkbenchReview }>(
    walkingAtStart && initialReview ? `/api/reviews/${initialReview.id}` : null,
    { intervalMs: WORKBENCH_POLL_MS },
  );
  const review = data?.review ?? initialReview;
  const walking = review ? REVIEW_WALKING.has(review.status) : false;
  const frame = review?.frame ?? null;

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
      ? `Loki is using it: ${frame.action || pathOf(frame.url)}`
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
          <span className="text-text-muted"> · {doing}</span>
        </>
      }
      aside={
        <Link
          href={`/projects/${encodeURIComponent(projectId)}/review`}
          className="ui-link shrink-0 text-sm"
        >
          {walking ? "Follow" : "Review it"}
        </Link>
      }
    >
      <button
        type="button"
        className="ui-workbench-site-page"
        onClick={onOpenSite}
        title={site.kind === "preview" ? "Open the preview" : "Open the site"}
      >
        {frame ? (
          <img
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt={`Loki's browser on ${frame.url}`}
          />
        ) : (
          <span className="ui-workbench-site-rest">
            <Globe className="h-7 w-7" aria-hidden="true" />
            <span className="text-text-primary">{host}</span>
            <span className="text-text-muted">Tap to open</span>
          </span>
        )}
      </button>
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
