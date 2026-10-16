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
 * When text cannot tell, Loki LOOKS: one phone-sized picture of the page
 * (page-picture.ts) is put to a vision model with the same question, and its
 * verdict replaces the text one (`via: "picture"`). The picture stays on the
 * run so the owner sees exactly what Loki saw, on the card. What a picture
 * cannot settle either — a flow, a sound, a page behind a login — is still
 * cannot_tell, and the card says which of the two Loki tried.
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

export const VERIFY_VIA = { TEXT: "text", PICTURE: "picture" } as const;
export type VerifyVia = (typeof VERIFY_VIA)[keyof typeof VERIFY_VIA];

export type FixVerify = {
  verdict: FixVerdict;
  /** One sentence, in Loki's words, naming what it saw on the page. */
  evidence: string;
  /** ISO — when the page was read. */
  at: string;
  /** The page that was read. */
  url: string;
  /** What settled it. */
  via: VerifyVia;
  /** A picture was taken and kept; /api/feedback/[id]/looked serves it. */
  picture: boolean;
};

/** A picture is worth taking only when text left the question open. */
export function wantsPicture(text: { verdict: FixVerdict } | null): boolean {
  return !text || text.verdict === FIX_VERDICT.CANNOT_TELL;
}

/**
 * The picture, kept on the run as a data URL; bigger than this and it is
 * dropped (the verdict stands), so one noisy page cannot bloat a row.
 */
export const PICTURE_MAX_CHARS = 400_000;
/** What one picture read costs the owner's budget, since the vision chain reports no tokens. */
export const PICTURE_TOKENS_ESTIMATE = 1_500;

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

/**
 * The evidence is read by the owner on a card, as Loki talking — so it says
 * what Loki looked at in plain words ("I read /projects: …"), never how it
 * was fed ("The provided page text does not contain…", owner's phone,
 * 2026-10-16).
 */
const VOICE_RULE =
  'Write the evidence as Loki speaking to the owner, in the first person and plain words ("I read the page and…", "On the page I see…"). Never mention "the provided text", "the page text", "the picture you were given", the prompt or the report as input.';

/** Machine phrasing a model still slips in, turned into how a person says it. */
export function speakEvidence(evidence: string | null | undefined): string | null {
  if (!evidence) return null;
  const spoken = evidence
    .replace(
      /\b(the )?(provided|given|supplied) (live )?(page )?(text|content|excerpt)\b/gi,
      "the page",
    )
    .replace(/\bthe (live )?page text\b/gi, "the page")
    .replace(/\b(the )?(provided|given|supplied) (picture|image|screenshot)\b/gi, "the screen")
    .replace(/\bthe page (does not|doesn't) contain\b/gi, "I could not find, on the page,")
    .replace(/^the page/, "The page")
    .trim();
  return spoken || null;
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
    VOICE_RULE,
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

export function pictureSystemPrompt(): string {
  return [
    "You check whether a website change is visible, for the site's owner, who will not look themselves if you can answer.",
    "You are given the report that asked for the change, what the agent said it did, and a picture of the live page on a phone (390px wide).",
    'Reply with JSON only: {"verdict":"looks_fixed"|"not_visible"|"cannot_tell","evidence":"<one sentence>"}.',
    "looks_fixed: the picture shows what the report asked for — say what you see, where on the screen.",
    "not_visible: the report asked for something the picture would show, and it is not there — say what is missing or still wrong.",
    "cannot_tell: the change is below the fold, behind a tap, or not a thing a still picture can show — say which.",
    "Never claim to see something that is not in the picture. Be short.",
    VOICE_RULE,
  ].join("\n");
}

export function picturePrompt(input: {
  report: string;
  didLine: string | null;
  pointedAt: string | null;
}): string {
  return [
    `The report: ${input.report.replace(/\s+/g, " ").trim().slice(0, 600)}`,
    input.pointedAt ? `The reporter pointed at: ${input.pointedAt}` : null,
    input.didLine ? `The agent said it did: ${input.didLine}` : "The agent left no summary.",
    input.pointedAt
      ? "The picture is the live page now, scrolled to what the reporter pointed at."
      : "The picture is the top of the live page now, on a phone.",
  ]
    .filter((line): line is string => !!line)
    .join("\n\n");
}

/** The element the reporter pointed at, in words a model can look for. */
export function pointedAtLine(
  els: Array<{ elementType?: string | null; elementText?: string | null }> | null | undefined,
): string | null {
  if (!els || els.length === 0) return null;
  const parts = els.slice(0, 3).map((el) => {
    const text = el.elementText?.replace(/\s+/g, " ").trim().slice(0, 80);
    return text
      ? `${el.elementType || "an element"} reading “${text}”`
      : el.elementType || "an element";
  });
  return parts.join("; ");
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
    // A behind-the-scenes change has nothing on the page to find; reading
    // the page would spend the owner's budget to learn "can't tell".
    fix.pr?.note?.shows !== "behind" &&
    !!livePageHref(item.liveUrl, item.url, item.page)
  );
}
