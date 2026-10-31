"use client";

import { Eye, Globe } from "lucide-react";
import Link from "next/link";
import { useFetch } from "@/hooks/use-fetch";
import { WORKBENCH_POLL_MS } from "@/config/workbench";
import { REVIEW_WALKING, type WorkbenchReview, type WorkbenchSite } from "./workbench-types";

/* eslint-disable @next/next/no-img-element -- Loki's own browser evidence, already-encoded JPEG served by this app; it must not pass through a public image optimizer. */

/**
 * The site, as Loki's browser sees it.
 *
 * Every fleet site forbids being framed, so the site cannot be shown live
 * inside Loki — but Loki's OWN browser on the box can be: the review worker
 * walks the site, clicks, and keeps one frame per action with the action
 * named (lib/inspection). While it walks, this region shows the walk, frame
 * by frame — the robot using the site, which no window of yours can show.
 * When it rests, it shows the last look it took. A tap on the picture opens
 * the real site in its own window, where you use it yourself and the widget
 * does the watching.
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
  const reviewHref = `/projects/${encodeURIComponent(projectId)}/review`;

  if (!site)
    return (
      <div className="ui-workbench-site-empty">
        <Globe className="h-6 w-6 text-text-muted" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          No site yet. It appears here once one is live.
        </p>
      </div>
    );

  return (
    <div className="ui-workbench-site">
      {frame ? (
        <button
          type="button"
          className="ui-workbench-site-frame"
          onClick={onOpenSite}
          title={site.kind === "preview" ? "Open the preview" : "Open the site"}
        >
          <img
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt={`Loki's browser on ${frame.url}`}
          />
        </button>
      ) : (
        <button type="button" className="ui-workbench-site-empty" onClick={onOpenSite}>
          <Globe className="h-6 w-6 text-text-muted" aria-hidden="true" />
          <span className="text-sm text-text-secondary">
            Loki has not looked at it yet. Tap to open {hostOf(site.url)}.
          </span>
        </button>
      )}
      <div className="ui-workbench-site-caption">
        <span className={walking ? "ui-dot-positive" : "ui-dot-neutral"} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
          {frame
            ? walking
              ? `Loki is using it: ${frame.action || pathOf(frame.url)}`
              : `Loki's last look: ${pathOf(frame.url)}`
            : hostOf(site.url)}
        </span>
        <Link href={reviewHref} className="ui-link shrink-0 text-sm">
          <Eye className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {walking ? "Follow" : "Review it"}
        </Link>
      </div>
    </div>
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
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
