/**
 * A change asked for from inside Loki by someone on the project — the second
 * door beside the site's Feedback button, and the same room behind it.
 *
 * Walking the loop as Manu (a Builder on George's Petvity, 2026-10-18): the
 * project page led with an orange "Ask Loki", which opened the chat in
 * Manu's own account. That account has no builder and no project of its
 * own, so the chat told him to "edit the site's HTML/CSS on a computer where
 * you have a builder… requires the Loki desktop app". The one promise the
 * invite made — say what should change and Loki builds it — broke on the
 * first tap inside Loki.
 *
 * So an ask here is filed exactly as the widget files a note proven by a
 * pass: a feedback row on the project, in the OWNER's tenant, naming who
 * asked. Whoever may edit the project (owner or Builder) starts the build at
 * once through startOwnerBuild — the owner's builder, never the asker's — and
 * the owner is told when it was a Builder. Anyone else's ask waits for the
 * owner, who is notified like any visitor note.
 */
import { getProjectAccess } from "@/db/queries/project-access";
import { bumpDuplicateFeedback, insertSiteFeedback } from "@/db/queries/site-feedback";
import { getUserById } from "@/db/queries/users";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { askReply } from "@/lib/project-capabilities";
import { feedbackContentHash } from "./content-hash";
import { notifyBuilderAsked, notifyFeedbackReceived } from "./notify-new";
import { startOwnerBuild } from "./owner-build";
import { watchFixPath } from "./tour-token";

export type AskResult =
  | { ok: true; building: boolean; say: string; followPath: string }
  | { ok: false; status: 403 | 500; error: string };

export async function askInLoki(input: {
  userId: string;
  projectId: string;
  text: string;
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

  // Asked twice is one row, as on the site: the same words again from someone
  // who may build means "do it", so a stalled attempt starts again.
  const contentHash = feedbackContentHash(input.text, null);
  const bumped = await bumpDuplicateFeedback(input.projectId, contentHash);
  const created = bumped
    ? null
    : await insertSiteFeedback({
        projectId: input.projectId,
        userId: ownerUserId,
        tokenId: null,
        suggestion: input.text,
        source: access.canEdit ? FEEDBACK_SOURCE.OWNER : FEEDBACK_SOURCE.VISITOR,
        reporterUserId: input.userId,
        contentHash,
      });
  const id = bumped ?? created?.id;
  if (!id) return { ok: false, status: 500, error: "Could not save that — try again." };
  // Announced once, when first filed — a visitor-sourced row tells the owner.
  if (created) void notifyFeedbackReceived(created);

  if (!access.canEdit) {
    return {
      ok: true,
      building: false,
      say: askReply(access.role, { owner, site, building: false }),
      // Their own list, not the fix's watch page: until the change is live
      // that page forwards to the owner's inbox, which a client cannot see,
      // so "See where it is" opened an empty Feedback page (2026-10-19).
      followPath: "/my-feedback",
    };
  }
  const build = await startOwnerBuild(ownerUserId, input.projectId, id);
  if (input.userId !== ownerUserId) void notifyBuilderAsked(id, input.userId, build.building);
  return {
    ok: true,
    building: build.building,
    say: askReply(access.role, { owner, site, ...build }),
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
