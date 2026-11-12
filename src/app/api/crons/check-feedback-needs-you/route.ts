// Cron — feedback that Needs you announces itself on Telegram.
//
// Implement that never got a PTY, a stalled agent, or a fix waiting for
// Check live / Confirm used to sit silent until someone opened Feedback.
// Boss-mode: ping when the flag goes up (same raise/refresh/resolve pattern
// as check-pending-approvals).
//
// The same tick follows chat builds to live (lib/run-follow-notify).
//
// Schedule: every 15 min at :05 (systemd timer, scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { syncFeedbackNeedsYou } from "@/lib/feedback/notify-needs-you";
import { autoRetryStuckFeedbackQueues } from "@/lib/feedback/retry-queued";
import { followChatRuns } from "@/lib/run-follow-notify";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const retry = await autoRetryStuckFeedbackQueues();
  const result = await syncFeedbackNeedsYou();
  // The same clock follows chat builds to live: a task sent from the chat
  // was otherwise told "pull request opened" and nothing after it unless its
  // card stayed open (lib/run-follow-notify). GitHub and the site's release
  // receipt only; no model.
  const followed = await followChatRuns().catch(() => ({ looked: 0, announced: 0 }));
  const didSomething =
    retry.retried > 0 ||
    result.raised > 0 ||
    result.pinged > 0 ||
    result.cleared > 0 ||
    followed.announced > 0;
  await logDebug({
    source: "crons/check-feedback-needs-you",
    level: didSomething ? "warn" : "info",
    message: `users ${result.users}: raised ${result.raised}, pinged ${result.pinged}, cleared ${result.cleared}`,
    meta: { ...result, retry, followed },
  });
  return NextResponse.json({ ok: true, ...result, retry, followed });
}
