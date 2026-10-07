/**
 * Reading a narration answer — server only (see lib/watch-narration for why
 * this is not in the module the Watch page imports).
 */
import { safeParseModelJson } from "@/lib/ai/model-json";
import type { Narration } from "@/lib/watch-narration";

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(null|none|n\/a|-)$/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The model's answer, or null when it gave nothing a person should read. */
export function parseNarration(raw: string): Narration | null {
  const json = safeParseModelJson<Record<string, unknown>>(raw);
  if (!json) return null;
  const headline = text(json.headline, 90);
  if (!headline) return null;
  return {
    headline,
    detail: text(json.detail, 200),
    needsYou: text(json.needsYou, 200),
  };
}
