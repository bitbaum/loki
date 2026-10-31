/** The project's site as the workbench offers it: the address people read,
 *  the address that is opened (the owner's link carries the pass that makes
 *  a note build at once, lib/feedback/owner-pass.ts), and whether it is the
 *  live site or a preview — the window must say which. */
export type WorkbenchSite = {
  url: string;
  href: string;
  kind: "live" | "preview";
};

/** What the site region shows: the latest look Loki's own browser took at
 *  the site (the review worker's frame, served by /api/reviews/[id]/frame),
 *  and whether that browser is still walking. */
export type WorkbenchReview = {
  id: string;
  status: string;
  frame: {
    url: string;
    image: string;
    width: number;
    height: number;
    action: string;
  } | null;
};

/** The review is still walking the site: keep asking for its latest frame. */
export const REVIEW_WALKING = new Set(["queued", "running", "paused"]);
