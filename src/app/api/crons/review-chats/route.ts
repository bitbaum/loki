// Cron target — the fleet chat review (docs/architecture/chat-review.md).
//
// The owner tried two of our chats and got walls: "nothing in our database",
// no web lookup, no way forward. Nothing in the fleet would have told anyone.
// This is the loop that does: every night, each product in
// config/chat-review.ts exports its day of conversations, and an agent run on
// that product's own Loki project judges every answer from the person's side
// — what they wanted, what the product could have given with the tools it
// has, what it gave — and files each gap into Loki's feedback inbox, where
// the autopilot night builds the fix.
//
// This route calls no model. No box timer may spend the shared free AI tier
// (scripts/test/no-free-background-ai.ts); the judge is the project's agent,
// dispatched the way the night reads a live page (lib/chat-review/dispatch.ts).
//
// Schedule: daily 03:40 UTC (scripts/install-hetzner-crons.sh), after the
// 02:30 night build has started its work and before the 07:00 digest.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import {
  CHAT_REVIEW_PRODUCTS,
  REVIEW_MAX_TRANSCRIPTS_PER_PRODUCT,
  REVIEW_WINDOW_MS,
} from "@/config/chat-review";
import { dispatchReview, fetchExport } from "@/lib/chat-review";

type ProductOutcome = {
  product: string;
  transcripts: number;
  /** The agent run that judges and files, when one was started. */
  runId: string | null;
  /** Why this product contributed nothing: the export refused, nothing to
   *  read, no project to file on, the dispatch refused. */
  skipped?: string;
};

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const token = process.env.CHAT_REVIEW_TOKEN?.trim() ?? "";
  const since = new Date(Date.now() - REVIEW_WINDOW_MS);
  const outcomes: ProductOutcome[] = [];

  for (const product of CHAT_REVIEW_PRODUCTS) {
    const outcome: ProductOutcome = { product: product.key, transcripts: 0, runId: null };
    outcomes.push(outcome);
    const fetched = await fetchExport(product, since, {
      token,
      limit: REVIEW_MAX_TRANSCRIPTS_PER_PRODUCT,
    });
    if (!fetched.ok) {
      outcome.skipped = `export: ${fetched.error}`;
      continue;
    }
    const transcripts = fetched.export.transcripts.slice(0, REVIEW_MAX_TRANSCRIPTS_PER_PRODUCT);
    outcome.transcripts = transcripts.length;
    const dispatched = await dispatchReview(product, fetched.export.scope, transcripts);
    if (dispatched.ok) outcome.runId = dispatched.runId;
    else outcome.skipped = dispatched.skipped;
  }

  const started = outcomes.filter((o) => o.runId).length;
  const skipped = outcomes.filter((o) => o.skipped);
  const summary = outcomes
    .map((o) => `${o.product}: ${o.transcripts} chats, ${o.runId ? "review started" : "no review"}`)
    .join("; ");

  // Written down, not only returned: the journal holds about a day, and the
  // night a product's export started refusing is the night worth reading.
  await logDebug({
    source: "crons/review-chats",
    level:
      !token || skipped.length === outcomes.length ? "error" : skipped.length ? "warn" : "info",
    message: !token
      ? "CHAT_REVIEW_TOKEN is not set — no product could be read"
      : skipped.length
        ? `${summary} — skipped ${skipped.map((o) => `${o.product} (${o.skipped})`).join(", ")}`
        : summary,
    meta: { since: since.toISOString(), products: outcomes },
  });

  return NextResponse.json({ ok: Boolean(token) && started > 0, started, products: outcomes });
}
