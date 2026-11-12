/**
 * What a person who sent a task from the chat is told when it ships, and
 * when: the pure half of lib/run-follow-notify (which reads the database and
 * GitHub, and so cannot be loaded by a test).
 */
import {
  shipAnnouncementFor,
  type FixShipping,
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
