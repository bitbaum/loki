/**
 * A change asked for from inside Loki by someone on the project — the second
 * door beside the site's Feedback button, and the same room behind it.
 *
 * Whoever asks pays, with their own engine, in their own builder
 * (docs/architecture/private-builders.md). So the OWNER's ask starts a build
 * at once on the owner's own builder: saying it is the decision. Anyone
 * else's ask — a Builder's, a client's, a viewer's — is filed as a
 * SUGGESTION in the owner's tenant, naming who asked, and waits for the
 * owner's tap like a visitor's note. Until 2026-10-20 a Builder's ask built
 * on the owner's subscription without asking, and a client's did the same
 * up to a monthly allowance; both spent one person's engine on another
 * person's word, and both are gone. A seat that brings a builder of its own
 * will build its own asks in its own tenant (docs/master-plan-2026-10.md,
 * Track 1); until then the reply says who decides.
 */
import { getProjectAccess } from "@/db/queries/project-access";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { getUserById } from "@/db/queries/users";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import type { NewSiteFeedback } from "@/db/schema";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { askReply } from "@/lib/project-capabilities";
import { feedbackContentHash } from "./content-hash";
import { notifyFeedbackReceived } from "./notify-new";
import { startOwnerBuild } from "./owner-build";
import { watchFixPath } from "./tour-token";

/** What the widget carries with a note, beyond the words. */
export type SiteAskFields = Pick<
  NewSiteFeedback,
  | "tokenId"
  | "page"
  | "url"
  | "pageTitle"
  | "scope"
  | "screenshots"
  | "selectedElements"
  | "moments"
  | "captureContext"
  | "contact"
  | "userAgent"
  | "requiresReview"
>;

export type AskResult =
  | { ok: true; building: boolean; say: string; followPath: string }
  | { ok: false; status: 403 | 500; error: string };

export async function askInLoki(input: {
  userId: string;
  projectId: string;
  text: string;
  /**
   * The same ask, filed from the SITE by a signed-in member (their member
   * pass in the widget): what the widget captured — the page, the spot they
   * pointed at, screenshots — and the hash the site's dedupe uses.
   */
  fromSite?: { fields: SiteAskFields; contentHash: string };
}): Promise<AskResult> {
  const access = await getProjectAccess(input.userId, input.projectId).catch(() => null);
  if (!access) return { ok: false, status: 403, error: "You are not on this project." };
  const ownerUserId = access.ownerUserId;
  const [ownerRow, runtime] = await Promise.all([
    getUserById(ownerUserId).catch(() => null),
    getUserProjectByEntityId(ownerUserId, input.projectId).catch(() => null),
  ]);
  const owner = ownerRow?.name?.trim() || "The owner";
  const site = hostOf(runtime?.liveUrl ?? null);
  // Only the owner's word starts a build: it is their builder and their engine.
  const owns = access.role === "owner";

  // Asked twice is one row, as on the site: the same words again from the
  // owner mean "do it", so a stalled attempt starts again.
  const contentHash = input.fromSite?.contentHash ?? feedbackContentHash(input.text, null);
  const bumped = await bumpDuplicateFeedback(input.projectId, contentHash);
  const created = bumped
    ? null
    : await insertSiteFeedback({
        tokenId: null,
        ...input.fromSite?.fields,
        projectId: input.projectId,
        userId: ownerUserId,
        suggestion: input.text,
        // A seat's ask is never the owner's word: it waits for a tap
        // (waitsForATap), so the night autopilot does not build it and the
        // fix does not merge itself as if the owner had said it.
        source: owns
          ? FEEDBACK_SOURCE.OWNER
          : access.role === "client"
            ? FEEDBACK_SOURCE.CLIENT
            : FEEDBACK_SOURCE.MEMBER,
        reporterUserId: input.userId,
        contentHash,
      });
  const id = bumped ?? created?.id;
  if (!id) return { ok: false, status: 500, error: "Could not save that — try again." };
  // The same words again from someone who does not build: it is already
  // with the owner — never a second nudge, never a build.
  if (bumped && !owns)
    return {
      ok: true,
      building: false,
      say: "You asked for this already. Your requests show where it is.",
      followPath: "/my-feedback",
    };

  if (!owns) {
    // Announced once, when first filed: the owner decides this one.
    if (created) void notifyFeedbackReceived(created);
    return {
      ok: true,
      building: false,
      say: askReply(access.role, { owner, site, building: false }),
      // Their own list, not the fix's watch page: until the change is live
      // that page forwards to the owner's inbox, which a member cannot see,
      // so "See where it is" opened an empty Feedback page (2026-10-19).
      followPath: "/my-feedback",
    };
  }
  const build = await startOwnerBuild(ownerUserId, input.projectId, id);
  return {
    ok: true,
    building: build.building,
    say: askReply("owner", { owner, site, ...build }),
    followPath: watchFixPath(id),
  };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
