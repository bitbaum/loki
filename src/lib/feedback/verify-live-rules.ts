/**
 * Loki looks before it asks you to.
 *
 * Owner, 2026-10-10: "How am I supposed to confirm if it worked or not? I
 * have to go and test it." A fix that shipped is a fact about GitHub; whether
 * the page now does what the report asked is a fact about the page — and
 * the owner was the only one checking it. So, once a fix is live, Loki reads
 * the live page and answers the report's question itself:
 *
 *   looks_fixed  — the page shows what was asked (and says what it saw)
 *   not_visible  — it could not find the change: the usual next step is a
 *                  second run, not a person's eyes
 *   cannot_tell  — the question is not answerable from page text (layout,
 *                  colour, a flow); one look by a person will settle it
 *
 * The verdict is cached on the run's fix ledger (payload.fix.verify), so it
 * is asked once per shipped fix, charged to the owner's AI budget, and only
 * from the inbox read a person made — never from a timer
 * (scripts/test/no-free-background-ai.ts walks the call graph).
 *
 * This file is the pure half — the page as text, the question, the verdict,
 * who is due — tested in scripts/test/feedback-verify-live.ts. The reader that
 * fetches, asks and writes is verify-live.ts.
 */
import { safeParseModelJson } from "@/lib/ai/model-json";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { FIX_SHIP_STATE, livePageHref, type FixShipping } from "@/lib/feedback/fix-shipping";

export const FIX_VERDICT = {
  LOOKS_FIXED: "looks_fixed",
  NOT_VISIBLE: "not_visible",
  CANNOT_TELL: "cannot_tell",
} as const;
export type FixVerdict = (typeof FIX_VERDICT)[keyof typeof FIX_VERDICT];

export type FixVerify = {
  verdict: FixVerdict;
  /** One sentence, in Loki's words, naming what it saw on the page. */
  evidence: string;
  /** ISO — when the page was read. */
  at: string;
  /** The page that was read. */
  url: string;
};

/** Live pages are read at most this many per inbox load — one read is one model call. */
export const VERIFY_MAX_PER_REQUEST = 2;
const PAGE_TEXT_MAX = 6_000;

/** The page as text: no scripts, no styles, no tags, entities decoded, capped. */
export function pageText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer|nav)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text.length > PAGE_TEXT_MAX ? `${text.slice(0, PAGE_TEXT_MAX)}…` : text;
}

export function verifySystemPrompt(): string {
  return [
    "You check whether a website change is visible, for the site's owner, who will not look themselves if you can answer.",
    "You are given the report that asked for the change, what the agent said it did, and the live page as plain text (no pixels, no layout).",
    'Reply with JSON only: {"verdict":"looks_fixed"|"not_visible"|"cannot_tell","evidence":"<one sentence>"}.',
    "looks_fixed: the page text shows what the report asked for — quote the words you found.",
    "not_visible: the report asked for something that page text would show, and it is not there — say what is missing.",
    "cannot_tell: the report is about layout, colour, size, an interaction, or a page you were not given — say why text cannot answer it.",
    "Never claim to have seen something that is not in the text. Be short.",
  ].join("\n");
}

export function verifyPrompt(input: {
  report: string;
  didLine: string | null;
  text: string;
}): string {
  return [
    `The report: ${input.report.replace(/\s+/g, " ").trim().slice(0, 600)}`,
    input.didLine ? `The agent said it did: ${input.didLine}` : "The agent left no summary.",
    "The live page, as text:",
    input.text || "(empty)",
  ].join("\n\n");
}

/** The model's answer, or null when it did not answer the question. */
export function parseVerdict(raw: string): { verdict: FixVerdict; evidence: string } | null {
  const obj = safeParseModelJson<{ verdict?: unknown; evidence?: unknown }>(raw);
  const verdict = Object.values(FIX_VERDICT).find((v) => v === obj?.verdict);
  if (!verdict) return null;
  const evidence = typeof obj?.evidence === "string" ? obj.evidence.trim().slice(0, 240) : "";
  return { verdict, evidence };
}

/** A live fix that has not been looked at. */
export function needsVerify(item: {
  status: string;
  liveUrl: string | null;
  url: string | null;
  page: string | null;
  work: { ship?: FixShipping | null };
}): boolean {
  const fix = item.work.ship;
  return (
    item.status === FEEDBACK_STATUS.DISPATCHED &&
    !!fix &&
    fix.state === FIX_SHIP_STATE.DEPLOYED &&
    !fix.verify &&
    !!livePageHref(item.liveUrl, item.url, item.page)
  );
}
