/**
 * What a person who sent a task from the chat is told when it ships, and
 * when: the pure half of lib/run-follow-notify (which reads the database and
 * GitHub, and so cannot be loaded by a test).
 */
import {
  shipAnnouncementFor,
  type FixShipping,
  type PrBlocker,
  type ShipAnnouncement,
} from "@/lib/feedback/fix-shipping";

/** A live (or failed) moment older than this is history, not news. */
export const ANNOUNCE_FRESH_MS = 2 * 60 * 60_000;
/**
 * Pure: does this ledger change deserve a word to the person who sent the
 * task? Only the change to live or to a failed deploy (shipAnnouncementFor),
 * and only while that moment is fresh.
 */
export function chatRunAnnouncement(
  before: FixShipping | null | undefined,
  after: FixShipping | null | undefined,
  now: number,
): ShipAnnouncement | null {
  const announcement = shipAnnouncementFor(before, after);
  if (!announcement || !after) return null;
  const at = Date.parse(after.deploy?.at ?? after.pr?.mergedAt ?? "");
  if (!Number.isFinite(at)) return null;
  return now - at <= ANNOUNCE_FRESH_MS ? announcement : null;
}

/** Pure: the line written into the thread, and the push that points at it. */
export function chatRunShippedMessage(input: {
  announcement: ShipAnnouncement;
  projectKey: string;
  fix: FixShipping;
  liveUrl: string | null;
}): { content: string; title: string; body: string } {
  const live = input.announcement === "live";
  const pr = input.fix.pr?.url ? `What changed: ${input.fix.pr.url}` : null;
  if (live) {
    const lines = [`🟢 **${input.projectKey}** — it is live.`];
    if (input.liveUrl) lines.push("", `The site: ${input.liveUrl}`);
    if (pr) lines.push(input.liveUrl ? pr : `\n${pr}`);
    return {
      content: lines.join("\n"),
      title: `${input.projectKey} · your change is live`,
      body: input.liveUrl ? `It is on ${input.liveUrl} now.` : "It merged and deployed.",
    };
  }
  const failed = input.fix.deploy?.url ? `The failed deploy: ${input.fix.deploy.url}` : null;
  const lines = [
    `🔴 **${input.projectKey}** — merged, but the deploy failed.`,
    "",
    "The site still shows the old version. The next deploy that succeeds ships this change with it; Loki says so here when it does.",
  ];
  if (failed) lines.push("", failed);
  if (pr) lines.push(failed ? pr : `\n${pr}`);
  return {
    content: lines.join("\n"),
    title: `${input.projectKey} · merged, but the deploy failed`,
    body: "The site still shows the old version.",
  };
}

/** How many failed checks are named before "and N more". */
const BLOCKED_CHECKS_NAMED = 3;

/**
 * Pure: the message a person sends to have the agent repair the pull request.
 *
 * Its wording is load-bearing, because the chat reads it back as a task:
 * - It names the pull request by NUMBER, not by its link. A link carries the
 *   repository owner's name, and a project of that name (bitbaum) then won the
 *   project match over the one the line is about (review, 2026-11-12).
 * - It opens with "In <project>," and not "<project>:", which for the project
 *   called loki reads as an address to the assistant (lib/project-mention).
 * - Both forms use a verb the chat's own rule takes as a task
 *   (lib/command-resolve looksLikeDispatchTask); scripts/test/run-follow-notify.ts
 *   holds all three.
 */
export function blockedRepairLine(input: {
  projectKey: string;
  blocked: PrBlocker;
  prNumber: number;
}): string {
  const { projectKey, blocked, prNumber } = input;
  return blocked.why === "conflict"
    ? `In ${projectKey}, update the branch of pull request #${prNumber} from main, fix the conflicts and push to the same branch.`
    : `In ${projectKey}, fix the failing checks on pull request #${prNumber} and push to the same branch.`;
}

/**
 * Pure: the line for a pull request that cannot merge as it stands, and the
 * push that points at it.
 *
 * It ends with the way forward as a message to send, because that is the one
 * action that certainly exists on a phone: a message naming the project is a
 * task for it. Loki does not send the repair itself: an agent run nobody
 * asked for spends the owner's quota (lib/auto-dispatch).
 */
export function chatRunBlockedMessage(input: {
  projectKey: string;
  blocked: PrBlocker;
  prUrl: string;
  prNumber: number;
}): { content: string; title: string; body: string } {
  const { projectKey, blocked, prUrl } = input;
  const conflict = blocked.why === "conflict";
  const named = blocked.checks.slice(0, BLOCKED_CHECKS_NAMED).join(", ");
  const more = blocked.checks.length - BLOCKED_CHECKS_NAMED;
  const count =
    blocked.checks.length === 1 ? "A check failed" : `${blocked.checks.length} checks failed`;
  const what = conflict
    ? "It conflicts with the main branch."
    : `${count}: ${named}${more > 0 ? ` and ${more} more` : ""}.`;
  return {
    content: [
      `🔴 **${projectKey}** — the pull request cannot merge yet.`,
      "",
      what,
      `The pull request: ${prUrl}`,
      "",
      "It stays open until this is repaired. To have the agent repair it, send this here:",
      "",
      blockedRepairLine(input),
    ].join("\n"),
    title: `${projectKey} · the pull request needs a repair`,
    body: what,
  };
}
