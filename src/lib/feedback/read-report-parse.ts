/**
 * Reading a report-read answer — server only (see lib/feedback/read-report for
 * why this is not in the module the browser imports).
 */
import { safeParseModelJson } from "@/lib/ai/model-json";
import {
  READ_ASK_MAX,
  READ_IMPACT_MAX,
  READ_MEANING_MAX,
  READ_RISK_MAX,
  READ_SIZES,
  type FeedbackRead,
  type ReadSize,
} from "@/lib/feedback/read-report";

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(null|none|n\/a|-)$/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The model's answer as a read, or null when it gave nothing a person should act on. */
export function parseFeedbackRead(raw: string, at = new Date()): FeedbackRead | null {
  const json = safeParseModelJson<Record<string, unknown>>(raw);
  if (!json) return null;
  const meaning = text(json.meaning, READ_MEANING_MAX);
  const ask = text(json.ask, READ_ASK_MAX);
  if (!meaning || !ask) return null;
  const size = (READ_SIZES as readonly string[]).includes(String(json.size))
    ? (json.size as ReadSize)
    : "medium";
  return {
    meaning,
    impact: text(json.impact, READ_IMPACT_MAX),
    size,
    risk: text(json.risk, READ_RISK_MAX),
    ask,
    at: at.toISOString(),
  };
}
