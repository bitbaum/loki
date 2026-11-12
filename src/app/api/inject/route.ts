/**
 * Thin HTTP boundary over the inject core (SSOT in src/lib/inject-core.ts).
 * Parses the body, authenticates, logs the unauthenticated case (needs the
 * request headers), then delegates to injectPrompt() — the same dispatcher the
 * Loki messages route calls in-process, so the two never drift.
 */
import { NextRequest, NextResponse } from "next/server";
import { ORCHESTRATION_ADAPTER_IDS } from "@/lib/orchestration";
import { getApiActor } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { AttachmentsField, foldAttachmentsIntoPrompt } from "@/lib/composer-attachments";
import { logDebug } from "@/db/queries/debug-logs";
import { injectPrompt } from "@/lib/inject-core";
import { shouldAnnounceOnClose } from "@/lib/orchestration/notify-close-format";

const InjectBody = z
  .object({
    tab: z.string().min(1).max(80),
    promptKey: z.string().optional(),
    customPrompt: z.string().max(4000).optional(),
    /** Screenshots and text files staged in the composer — see
     *  lib/composer-attachments for why an image becomes text before it ships. */
    attachments: AttachmentsField,
    adapter: z.enum(ORCHESTRATION_ADAPTER_IDS).optional(),
    runId: z.string().uuid().optional(),
    // Chat-originated dispatches (Loki's fleet skill) ask for the outcome to be
    // pushed back to chat on close — see lib/orchestration/notify-close.ts.
    notifyOnClose: z.boolean().optional(),
    // "fresh": a new session in its own worktree for this one prompt, closed
    // when it reports; never the project's shared session (inject-core).
    session: z.enum(["shared", "fresh"]).optional(),
  })
  .refine((d) => d.promptKey || d.customPrompt, { message: "promptKey or customPrompt required" });

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, InjectBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { tab, promptKey, adapter, runId, notifyOnClose, attachments, session } = dataOrResp;
  // Screenshots become text before anything downstream sees the prompt, so the
  // agent, prompt history and Activity all record the same instruction.
  const customPrompt = dataOrResp.customPrompt
    ? await foldAttachmentsIntoPrompt(dataOrResp.customPrompt, attachments)
    : dataOrResp.customPrompt;

  const actor = await getApiActor();
  const userId = actor?.userId ?? null;
  if (!userId) {
    // Session-expiry / unauthenticated path. This is the most likely
    // server-side root cause of the "I sent something but it isn't here"
    // mobile incident — a long-lived mobile tab whose JWT lapsed, the
    // client throws and surfaces the inline error (post-9c2525c), and
    // forensics need the server-side counterpart to correlate. Body has
    // already parsed at this point, so a 401 here is a real user attempt
    // (random bots fail readJsonBody → 400 above, never reach this line).
    logDebug({
      source: "api/inject",
      level: "warn",
      message: "Unauthenticated inject attempt — likely session expiry",
      meta: {
        tab,
        adapter: adapter ?? "claude",
        hasPromptKey: !!promptKey,
        hasCustomPrompt: !!customPrompt,
        customPromptLen: customPrompt?.length ?? 0,
        userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
        referer: req.headers.get("referer") ?? null,
      },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A person clicked Send and may well close the tab — announce the outcome.
  // A Bearer token is a runner or a scheduled loop, and announcing every one of
  // those is what "UI dispatches stay silent" was originally protecting against.
  // An explicit value in the body still wins, so a caller can opt either way.
  const announce = shouldAnnounceOnClose(actor, notifyOnClose);

  const { status, body } = await injectPrompt(
    { tab, promptKey, customPrompt, adapter, runId, notifyOnClose: announce, session },
    userId,
  );
  return NextResponse.json(body, { status });
}
