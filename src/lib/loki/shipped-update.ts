import { tidyFixNote } from "@/lib/feedback/fix-note";
import { watchFixPath } from "@/lib/feedback/tour-token";
import { feedbackScreenshotPath } from "@/lib/loki/update-images";
import {
  buildProgressUpdate,
  UPDATE_STAGE,
  type ProgressUpdate,
  type UpdateImage,
  type UpdateLink,
} from "@/lib/loki/progress-update";
import type { FixShipping, ShipAnnouncement } from "@/lib/feedback/fix-shipping";

/**
 * The update for a fix that went live or failed to deploy. Pure — posted by
 * post-shipped-update.ts, pinned by scripts/test/progress-update.ts.
 */

export type ShippedUpdateInput = {
  announcement: ShipAnnouncement;
  projectKey: string;
  feedbackId: string;
  asked: string | null;
  hasScreenshot: boolean;
  fix: FixShipping;
  livePageUrl: string | null;
  didLine: string | null;
  summaryNext: string | null;
  /** A picture of the live page taken once it went live (post-shipped-update.ts). */
  after?: UpdateImage | null;
};

/** Does this update owe an "after" picture? Only a live change someone can
 *  see: a failed deploy shows the old page, and a behind-the-scenes fix
 *  would be a picture of a page that did not change. */
export function wantsAfterPicture(
  input: Pick<ShippedUpdateInput, "announcement" | "fix" | "livePageUrl">,
): boolean {
  return (
    input.announcement === "live" && !!input.livePageUrl && input.fix.pr?.note?.shows !== "behind"
  );
}

/** Pure: the update for a fix that went live or failed to deploy. */
export function buildShippedUpdate(input: ShippedUpdateInput): ProgressUpdate {
  const live = input.announcement === "live";
  // A change that works behind the scenes has nothing on the page to watch:
  // the update explains it and shows its proof instead of a walkthrough
  // pointing at a page that did not change.
  const visible = input.fix.pr?.note?.shows !== "behind";
  const links: UpdateLink[] = [];
  if (live && visible && input.livePageUrl) {
    links.push({ label: "Watch the fix", href: watchFixPath(input.feedbackId), primary: true });
    links.push({ label: "The page", href: input.livePageUrl });
  }
  if (!live && input.fix.deploy?.url)
    links.push({ label: "The failed deploy", href: input.fix.deploy.url, primary: true });
  if (input.fix.pr?.url) links.push({ label: "What changed", href: input.fix.pr.url });

  let where: string | null = null;
  try {
    where = input.livePageUrl ? new URL(input.livePageUrl).pathname : null;
  } catch {
    where = null;
  }

  return buildProgressUpdate({
    stage: live ? UPDATE_STAGE.LIVE : UPDATE_STAGE.DEPLOY_FAILED,
    project: input.projectKey,
    asked: input.asked,
    note: input.fix.pr?.note ? tidyFixNote(input.fix.pr.note) : null,
    didLine: input.didLine,
    summaryNext: input.summaryNext,
    where,
    deployName: input.fix.deploy?.name ?? null,
    // Before beside after: the report's own screenshot, then the live page.
    images: [
      ...(input.hasScreenshot
        ? [
            {
              src: feedbackScreenshotPath(input.feedbackId, 0),
              caption: "Before — the screenshot that came with the report",
            },
          ]
        : []),
      ...(input.after && wantsAfterPicture(input) ? [input.after] : []),
    ],
    links,
  });
}
