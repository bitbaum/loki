import { safeParseModelJson } from "@/lib/ai/model-json";
import {
  PREVIEW_CSS_MAX,
  PREVIEW_HTML_MAX,
  PREVIEW_MAX_OPS,
  type PreviewOp,
} from "../../../widget/preview";
import type { TourOutlineItem } from "../../../widget/tour";

/**
 * "Show me" (widget/preview.ts): the prompt that turns "what I'd want instead"
 * into a few edits the widget can apply to the live page, and the reader that
 * keeps only edits of the closed vocabulary with targets that exist. Pure —
 * the route supplies the model call. The widget sanitizes again before it
 * touches the page; this file only decides what is worth sending.
 */

export const PREVIEW_ASK_MAX = 1000;

export type PreviewInput = {
  /** What the person wants, in their words. */
  ask: string;
  /** The fix this walkthrough showed, for context. */
  fixedFor: string;
  outline: TourOutlineItem[];
  path: string | null;
};

export function previewSystemPrompt(): string {
  return [
    "You show a website's owner what a change would look like, by editing the live page in their browser only. Nothing you do is saved.",
    "You see a numbered outline of the visible page (document order), not pixels or CSS.",
    "Reply with JSON only:",
    '{"summary":"<one plain sentence: what the preview shows, in the language the owner wrote in>","ops":[...]}',
    `At most ${PREVIEW_MAX_OPS} ops, each one of:`,
    '- {"op":"style","target":<n>,"css":{"<property>":"<value>"}} — restyle element n (colors, sizes, spacing, fonts, borders, layout).',
    '- {"op":"text","target":<n>,"text":"<new text>"} — replace the words of element n (a heading, a button, a link).',
    '- {"op":"hide","target":<n>} — hide element n.',
    `- {"op":"insert","target":<n>,"where":"before"|"after"|"prepend"|"append","html":"<simple HTML, under ${PREVIEW_HTML_MAX} characters>"} — add something new next to or inside element n.`,
    `- {"op":"css","css":"<a stylesheet, under ${PREVIEW_CSS_MAX} characters>"} — page-wide styling, using selectors that exist on the page (tags, the ids in the outline).`,
    "Rules:",
    "- Do what was asked, as a good designer would, and nothing else.",
    "- HTML: plain tags only (div, section, h2, h3, p, a, img, ul, li, strong, button, …), inline style attributes for looks. No scripts, no event handlers, no forms, no iframes.",
    "- No url() in CSS and no external images except https photos you are sure exist; prefer colors, gradients and text.",
    "- Only use outline numbers that exist. Text you put ON the page is in the page's language; the summary is in the owner's.",
    '- If it cannot be shown this way (it needs data, a new page, or code), return {"summary":"<why, in one sentence>","ops":[]}.',
  ].join("\n");
}

export function previewPrompt(input: PreviewInput): string {
  const outline = input.outline
    .map((o) => `${o.i}. <${o.tag}${o.id ? ` id=${o.id}` : ""}> ${o.text}`)
    .join("\n");
  return [
    `What the owner wants to see: ${input.ask.slice(0, PREVIEW_ASK_MAX)}`,
    `(This page was just changed for: ${input.fixedFor.slice(0, 300)})`,
    input.path ? `Page: ${input.path}` : null,
    "",
    "Visible page outline:",
    outline || "(empty)",
    "",
    // Last, beside the owner's own words: a system-prompt rule alone lost to
    // an all-Italian outline and answered the owner in Italian (2026-10-08).
    `Write "summary" in the language of this, the owner's own request: “${input.ask.slice(0, 120)}” — even when the page is in another language.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : null;

/** Keep only well-formed edits with real targets. */
export function parsePreviewOps(
  raw: string,
  outlineLength: number,
): { summary: string | null; ops: PreviewOp[] } {
  const parsed = safeParseModelJson<{ summary?: unknown; ops?: unknown }>(raw);
  if (!parsed || typeof parsed !== "object") return { summary: null, ops: [] };
  const summary = str(parsed.summary, 240);
  const list = Array.isArray(parsed.ops) ? parsed.ops : [];
  const ops: PreviewOp[] = [];
  const target = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < outlineLength ? v : null;
  for (const o of list) {
    if (ops.length >= PREVIEW_MAX_OPS) break;
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (r.op === "css") {
      const css = str(r.css, PREVIEW_CSS_MAX);
      if (css) ops.push({ op: "css", css });
      continue;
    }
    const t = target(r.target);
    if (t === null) continue;
    if (r.op === "hide") ops.push({ op: "hide", target: t });
    else if (r.op === "text") {
      const text = str(r.text, 400);
      if (text) ops.push({ op: "text", target: t, text });
    } else if (r.op === "style" && r.css && typeof r.css === "object") {
      const css: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.css as Record<string, unknown>).slice(0, 20))
        if (typeof v === "string" || typeof v === "number") css[k] = String(v);
      if (Object.keys(css).length) ops.push({ op: "style", target: t, css });
    } else if (r.op === "insert") {
      const html = str(r.html, PREVIEW_HTML_MAX);
      const where = ["before", "after", "prepend", "append"].includes(r.where as string)
        ? (r.where as "before" | "after" | "prepend" | "append")
        : "after";
      if (html) ops.push({ op: "insert", target: t, where, html });
    }
  }
  return { summary, ops };
}
