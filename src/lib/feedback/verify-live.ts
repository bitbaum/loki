/**
 * Loki looks before it asks you to — the reader. The rules (what the page
 * becomes as text, the questions, the verdict, who is due) are in
 * verify-live-rules.ts; this file fetches the page, asks the model on the
 * owner's budget, and writes the verdict onto the run's fix ledger.
 *
 * Two looks, in order, each only if the one before left the question open:
 *   1. the page as text, to the chat model — cheap, settles copy and content;
 *   2. a phone-sized picture of the page, to the vision chain — settles
 *      layout, colour, overlap; the picture is kept on the run so the owner
 *      can see what Loki saw without leaving the card.
 *
 * Called from the inbox read a person made — never from a timer
 * (scripts/test/no-free-background-ai.ts walks the call graph).
 */
import { callTextDetailed } from "@/lib/groq";
import { analyzeImages } from "@/lib/vision";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import {
  getOrchestrationRunsByIds,
  mergeRunPayload,
  stampRunFix,
} from "@/db/queries/orchestration-runs";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { livePageHref, type FixShipping } from "@/lib/feedback/fix-shipping";
import { takePagePicture } from "@/lib/feedback/page-picture";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import {
  FIX_VERDICT,
  PICTURE_MAX_CHARS,
  PICTURE_TOKENS_ESTIMATE,
  VERIFY_MAX_PER_REQUEST,
  VERIFY_VIA,
  needsVerify,
  pageText,
  parseVerdict,
  pictureSystemPrompt,
  picturePrompt,
  pointedAtLine,
  verifyPrompt,
  verifySystemPrompt,
  wantsPicture,
  type FixVerdict,
  type FixVerify,
} from "@/lib/feedback/verify-live-rules";

const FETCH_TIMEOUT_MS = 10_000;
type Answer = { verdict: FixVerdict; evidence: string };

/** What the look is checking for: what was asked, what the agent said it did,
 *  and (from a feedback report) what the reporter pointed at. */
export type PageAsk = {
  report: string;
  didLine: string | null;
  selector: string | null;
  pointedAt: string | null;
};

async function readPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html", "user-agent": "Loki fix check" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return pageText(await res.text());
  } catch {
    return null;
  }
}

/** Look 1: the page as text. Null when the page or the model did not answer. */
async function askText(
  userId: string,
  ask: PageAsk,
  url: string,
): Promise<{ answer: Answer | null; read: boolean }> {
  const text = await readPage(url);
  if (!text) return { answer: null, read: false };
  try {
    const answered = await callTextDetailed(
      verifyPrompt({ report: ask.report, didLine: ask.didLine, text }),
      {
        feature: "fix-verify",
        systemPrompt: verifySystemPrompt(),
        maxTokens: 300,
        temperature: 0.1,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    void recordAiSpend(userId, answered.tokens);
    return { answer: parseVerdict(answered.text), read: true };
  } catch (e) {
    console.warn("[fix-verify] model unavailable:", e instanceof Error ? e.message : e);
    return { answer: null, read: true };
  }
}

/**
 * Look 2: a picture of the page. The picture is returned even when no vision
 * model answered — the owner's eyes are the fallback, and the card can show
 * them the page without a trip to the site.
 */
async function askPicture(
  userId: string,
  ask: PageAsk,
  url: string,
  /** False when the owner's AI budget (or the server's capacity) says no model
   *  call today: the picture is still taken — it costs nothing and the owner's
   *  eyes are the fallback — and only the asking is skipped. */
  mayAsk: boolean,
): Promise<{ answer: Answer | null; dataUrl: string | null; failed: string | null }> {
  const shot = await takePagePicture(url, ask.selector);
  if (!shot.ok) {
    return {
      answer: null,
      dataUrl: null,
      failed:
        shot.reason !== "did-not-load"
          ? "this server has no browser to take a picture with"
          : "the page did not load for a picture",
    };
  }
  const dataUrl = `data:${shot.mimeType};base64,${shot.base64}`;
  if (!mayAsk) return { answer: null, dataUrl, failed: "no AI budget was left to read it" };
  try {
    const seen = await analyzeImages({
      systemPrompt: pictureSystemPrompt(),
      prompt: picturePrompt({ report: ask.report, didLine: ask.didLine, pointedAt: ask.pointedAt }),
      images: [{ mimeType: shot.mimeType, dataBase64: shot.base64, name: "live page" }],
      maxTokens: 300,
      timeoutMs: HTTP_TIMEOUT_LONG_MS,
    });
    void recordAiSpend(userId, PICTURE_TOKENS_ESTIMATE);
    return { answer: parseVerdict(seen.text), dataUrl, failed: null };
  } catch (e) {
    console.warn("[fix-verify] vision unavailable:", e instanceof Error ? e.message : e);
    return { answer: null, dataUrl, failed: "no vision model answered" };
  }
}

/**
 * Look at every live fix that has not been looked at, a few per request,
 * and write the verdict onto the run's ledger. Returns the items with the
 * verdict attached, so the caller's page shows it on this same load.
 */
export async function verifyDeployedFixes<T extends FeedbackListItemWithWork>(
  userId: string,
  items: T[],
): Promise<T[]> {
  const due = items.filter(needsVerify).slice(0, VERIFY_MAX_PER_REQUEST);
  if (due.length === 0) return items;
  // No budget means no model call — not no look. The picture is free, and a
  // verdict that says "no AI was available, here is the page" is still more
  // than "cannot tell".
  const budget = await checkAiBudget(userId).catch(() => ({ allowed: false as const }));
  const mayAsk = budget.allowed;
  const runs = await getOrchestrationRunsByIds(
    userId,
    due.map((i) => i.dispatchedRunId).filter((id): id is string => !!id),
  );
  const verified = new Map<string, FixVerify>();
  await Promise.all(
    due.map(async (item) => {
      const url = livePageHref(item.liveUrl, item.url, item.page);
      const fix = item.work.ship;
      if (!url || !fix || !item.dispatchedRunId) return;
      const run = runs.get(item.dispatchedRunId);
      const current = (run?.payload as { fix?: FixShipping } | null)?.fix ?? fix;
      const verify = await lookAndRecord(userId, item.dispatchedRunId, current, url, mayAsk, {
        report: item.suggestion,
        didLine: item.work.didLine ?? null,
        selector: item.selectedElements?.[0]?.selector ?? null,
        pointedAt: pointedAtLine(item.selectedElements),
      });
      verified.set(item.id, verify);
    }),
  );
  if (verified.size === 0) return items;
  return items.map((item) => {
    const verify = verified.get(item.id);
    if (!verify || !item.work.ship) return item;
    return { ...item, work: { ...item.work, ship: { ...item.work.ship, verify } } };
  });
}

/**
 * The look itself, for any run whose change is live: text first, a picture
 * only if text left it open, and the verdict written onto the run's ledger
 * (replaced whole, so `current` must be the newest copy). The feedback inbox
 * and the Loki chat card (lib/run-follow.ts) both come through here.
 */
export async function lookAndRecord(
  userId: string,
  runId: string,
  current: FixShipping,
  url: string,
  mayAsk: boolean,
  ask: PageAsk,
): Promise<FixVerify> {
  const text = mayAsk ? await askText(userId, ask, url) : { answer: null, read: true };
  let answer = text.answer;
  let via: FixVerify["via"] = VERIFY_VIA.TEXT;
  let picture: string | null = null;
  let pictureFailed: string | null = null;
  if (wantsPicture(answer)) {
    const looked = await askPicture(userId, ask, url, mayAsk);
    picture = looked.dataUrl;
    pictureFailed = looked.failed;
    if (looked.answer) {
      answer = looked.answer;
      via = VERIFY_VIA.PICTURE;
    }
  }
  const kept = !!picture && picture.length <= PICTURE_MAX_CHARS;
  const verify: FixVerify = {
    verdict: answer?.verdict ?? FIX_VERDICT.CANNOT_TELL,
    evidence: answer?.evidence || fallbackEvidence(text.read, pictureFailed, kept, mayAsk),
    at: new Date().toISOString(),
    url,
    via,
    picture: kept,
  };
  await stampRunFix(runId, userId, { ...current, verify }).catch(() => {});
  if (kept && picture) await mergeRunPayload(runId, { fixPicture: picture }).catch(() => {});
  return verify;
}

/** When no model answered, say in one line which looks were tried and why they stopped. */
function fallbackEvidence(
  pageRead: boolean,
  pictureFailed: string | null,
  kept: boolean,
  mayAsk: boolean,
): string {
  if (!mayAsk)
    return kept
      ? "No AI budget was left to read the page, so Loki took this picture for you instead."
      : `No AI budget was left to read the page, and ${pictureFailed ?? "no picture could be taken"}.`;
  if (!pageRead) return "The live page could not be read.";
  if (kept)
    return "Text could not settle it, and no vision model read the picture — it is here for you.";
  if (pictureFailed) return `Text could not settle it, and ${pictureFailed}.`;
  return "The page text did not settle it.";
}
