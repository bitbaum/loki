/**
 * "Make it live": the client says their change may go on the site.
 *
 * A change built for the person who asked (`previewFirst`) opens as a draft
 * pull request and merges on their word only (auto-ship.ts). This records the word, then asks
 * the fix ledger to act on it at once — the same refresh the owner's inbox
 * runs — so the client is not left waiting for someone to open a page. When
 * GitHub is not ready yet (checks running), the next refresh merges it.
 *
 * Who may say it: the client who asked, or anyone who builds the project. The
 * owner hears that it was said, so a change that cannot merge on its own
 * (no checks, a conflict) has someone to finish it.
 */
import { getProjectAccess } from "@/db/queries/project-access";
import {
  approveFeedbackLive,
  getFeedbackForTour,
  listProjectFeedback,
} from "@/db/queries/site-feedback";
import { getUserById } from "@/db/queries/users";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

export type GoLiveResult =
  { ok: true; live: boolean } | { ok: false; status: 403 | 404 | 409; error: string };

export async function makeItLive(userId: string, feedbackId: string): Promise<GoLiveResult> {
  const record = await getFeedbackForTour(feedbackId);
  if (!record) return { ok: false, status: 404, error: "That change was not found." };
  const { feedback } = record;
  const access = await getProjectAccess(userId, feedback.projectId).catch(() => null);
  const mayDecide =
    access?.canEdit === true || (access?.role === "client" && feedback.reporterUserId === userId);
  if (!access || !mayDecide)
    return { ok: false, status: 403, error: "Only the person who asked for it can put it live." };
  if (!feedback.previewFirst)
    return {
      ok: false,
      status: 409,
      error: "The site's owner puts this one live.",
    };

  await approveFeedbackLive(feedbackId, userId);
  const owner = access.ownerUserId;
  // The owner's own refresh, for this one row: lifts the draft and merges it
  // when GitHub agrees. A failure here only delays it to the next refresh.
  const item = (await listProjectFeedback(owner, feedback.projectId).catch(() => [])).find(
    (f) => f.id === feedbackId,
  );
  const [refreshed] = item ? await attachFeedbackWork(owner, [item]).catch(() => []) : [];
  const state = refreshed?.work?.ship?.state ?? null;
  const live = state === FIX_SHIP_STATE.MERGED || state === FIX_SHIP_STATE.DEPLOYED;

  if (userId !== owner) {
    const who = (await getUserById(userId).catch(() => null))?.name?.trim() || "Your client";
    const words = feedback.suggestion.replace(/\s+/g, " ").trim().slice(0, 140);
    void pushToUser(owner, {
      title: `${record.projectName} · ${who} said make it live`,
      body: `“${words}” — ${live ? "it is merging now." : "it goes live once its checks pass."}`,
      url: `/feedback?project=${encodeURIComponent(record.projectName)}`,
      tag: `${PUSH_TAG_PREFIX}feedback-${feedback.projectId}`,
    }).catch(() => undefined);
  }
  return { ok: true, live };
}
