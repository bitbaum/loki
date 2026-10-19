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
 * the owner is told when it was a Builder. A client with changes left this
 * month builds the same way, and their change waits for their "Make it live".
 * Anyone else's ask waits for the owner, who is notified like any visitor note.
 */
import { getProjectAccess } from "@/db/queries/project-access";
import {
  bumpDuplicateFeedback,
  countAllowanceUsed,
  insertSiteFeedback,
  setOnAllowance,
} from "@/db/queries/site-feedback";
import { allowanceMonthStart, changesLeft } from "@/config/client-allowance";
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

  // A client with an allowance left builds at once, like a Builder — but
  // their change waits for their own "Make it live" (feedback/auto-ship.ts).
  const allowance = await clientAllowance(access, input);
  const builds = access.canEdit || (allowance?.left ?? 0) > 0;

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
        source: access.canEdit
          ? FEEDBACK_SOURCE.OWNER
          : access.role === "client"
            ? FEEDBACK_SOURCE.CLIENT
            : FEEDBACK_SOURCE.VISITOR,
        reporterUserId: input.userId,
        contentHash,
        // Read by the fix prompt, so it is set before the build starts.
        onAllowance: !access.canEdit && builds,
      });
  const id = bumped ?? created?.id;
  if (!id) return { ok: false, status: 500, error: "Could not save that — try again." };
  // The same words again from someone who does not build: it is already on
  // its way or with the owner — never a second build, and never one that
  // skips the allowance by riding on a row the owner had not started.
  if (bumped && !access.canEdit)
    return {
      ok: true,
      building: false,
      say: "You asked for this already. Your requests show where it is.",
      followPath: "/my-feedback",
    };

  if (!builds) {
    // Announced once, when first filed: the owner decides this one.
    if (created) void notifyFeedbackReceived(created);
    return {
      ok: true,
      building: false,
      say: askReply(access.role, { owner, site, building: false, allowance }),
      // Their own list, not the fix's watch page: until the change is live
      // that page forwards to the owner's inbox, which a client cannot see,
      // so "See where it is" opened an empty Feedback page (2026-10-19).
      followPath: "/my-feedback",
    };
  }
  const build = await startOwnerBuild(ownerUserId, input.projectId, id);
  // An allowance pays for builds, not for attempts: one that did not start
  // is the owner's to start, and costs the client nothing.
  if (created?.onAllowance && !build.building) await setOnAllowance(id, false);
  const spent = allowance && created?.onAllowance && build.building ? 1 : 0;
  const after = allowance ? { ...allowance, left: allowance.left - spent } : null;
  if (input.userId !== ownerUserId) void notifyBuilderAsked(id, input.userId, build.building);
  return {
    ok: true,
    building: build.building,
    say: askReply(access.role, {
      owner,
      site,
      ...build,
      allowance: after,
      // A change on a repository waits for the client's "Make it live"; a
      // preview folder has no live site yet, so they simply see it there.
      waitsForYes: !!created?.onAllowance && !!runtime?.gitUrl,
    }),
    followPath: access.canEdit ? watchFixPath(id) : "/my-feedback",
  };
}

/** A client's allowance this month, or null for anyone without one. */
async function clientAllowance(
  access: { role: string; monthlyChanges: number | null },
  input: { userId: string; projectId: string },
): Promise<{ limit: number; left: number } | null> {
  if (access.role !== "client" || !access.monthlyChanges) return null;
  const used = await countAllowanceUsed(
    input.projectId,
    input.userId,
    allowanceMonthStart(new Date()),
  );
  const left = changesLeft(access.monthlyChanges, used);
  return left === null ? null : { limit: access.monthlyChanges, left };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
