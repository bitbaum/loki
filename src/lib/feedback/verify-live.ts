/**
 * Loki looks before it asks you to — the reader. The rules (what the page
 * becomes as text, the question, the verdict, who is due) are in
 * verify-live-rules.ts; this file fetches the page, asks the model on the
 * owner's budget, and writes the verdict onto the run's fix ledger.
 * Called from the inbox read a person made — never from a timer
 * (scripts/test/no-free-background-ai.ts walks the call graph).
 */
import { callTextDetailed } from "@/lib/groq";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { getOrchestrationRunsByIds, stampRunFix } from "@/db/queries/orchestration-runs";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { livePageHref, type FixShipping } from "@/lib/feedback/fix-shipping";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import {
  FIX_VERDICT,
  VERIFY_MAX_PER_REQUEST,
  needsVerify,
  pageText,
  parseVerdict,
  verifyPrompt,
  verifySystemPrompt,
  type FixVerdict,
  type FixVerify,
} from "@/lib/feedback/verify-live-rules";

const FETCH_TIMEOUT_MS = 10_000;

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
  const budget = await checkAiBudget(userId).catch(() => ({ allowed: false as const }));
  if (!budget.allowed) return items;
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
      const text = await readPage(url);
      let result: { verdict: FixVerdict; evidence: string } | null = null;
      if (text) {
        try {
          const answered = await callTextDetailed(
            verifyPrompt({ report: item.suggestion, didLine: item.work.didLine ?? null, text }),
            {
              feature: "fix-verify",
              systemPrompt: verifySystemPrompt(),
              maxTokens: 300,
              temperature: 0.1,
              timeoutMs: HTTP_TIMEOUT_LONG_MS,
            },
          );
          void recordAiSpend(userId, answered.tokens);
          result = parseVerdict(answered.text);
        } catch (e) {
          console.warn("[fix-verify] model unavailable:", e instanceof Error ? e.message : e);
        }
      }
      const verify: FixVerify = {
        verdict: result?.verdict ?? FIX_VERDICT.CANNOT_TELL,
        evidence:
          result?.evidence ||
          (text ? "The page text did not settle it." : "The live page could not be read."),
        at: new Date().toISOString(),
        url,
      };
      // The ledger is replaced whole, so start from the newest copy on the run.
      const run = runs.get(item.dispatchedRunId);
      const current = (run?.payload as { fix?: FixShipping } | null)?.fix ?? fix;
      await stampRunFix(item.dispatchedRunId, userId, { ...current, verify }).catch(() => {});
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
