import type { QuotaRowView } from "@/lib/ai/quota-view";

/**
 * What is left on a person's OWN key, in the vendor's words.
 *
 * Loki puts no cap on a key the person brought, so "how much do I have left?"
 * is a question about their account at the vendor — Groq's free tier refuses
 * at its own daily ceiling whatever Loki does. The vendor says how much is left
 * on every answer, in the same rate-limit headers the free pool is read from
 * (lib/ai/record-quota.ts); those readings are stored under the person's id,
 * never the pool's, and this turns them into one sentence.
 *
 * Daily counters lead: "840 of 1,000 requests today" is the answer to the
 * question, and "5,400 of 6,000 tokens this minute" is not. A spent counter
 * leads over everything, whatever its window — it is the one that refuses the
 * next answer. Stale and skipped readings say nothing about now and are left
 * out; with nothing current, there is no sentence rather than an invented one.
 *
 * Pure: the described rows for this person's vendor in, a sentence out.
 */
export type OwnKeyLeft = {
  /** For Settings: "On your Groq account: 840 of 1,000 requests today · refills in 9 hours." */
  line: string;
  /** For a picker row, whose blurb already names the vendor: "840 of 1,000 requests left today". */
  short: string;
  /** The vendor is refusing until the refill. */
  spent: boolean;
};

export function ownKeyLeft(rows: QuotaRowView[], label: string, model: string): OwnKeyLeft | null {
  const current = rows.filter((r) => r.state === "known" || r.state === "exhausted");
  // The chosen model's counters when the vendor reported them; a vendor that
  // meters per key rather than per model reports them under whatever model
  // answered last, and those are this key's too.
  const forModel = current.filter((r) => r.model === model);
  const pool = forModel.length > 0 ? forModel : current;
  if (pool.length === 0) return null;

  const spent = pool.find((r) => r.state === "exhausted");
  if (spent) {
    const back = spent.refills ? ` · refills ${spent.refills}` : "";
    return {
      line: `Your ${label} account is refusing for now: ${spent.detail}${back}.`,
      short: `None left on your account${spent.refills ? ` — back ${spent.refills}` : ""}`,
      spent: true,
    };
  }

  const daily = pool.filter((r) => r.detail.endsWith(" today"));
  const shown = (daily.length > 0 ? daily : pool.slice(0, 1)).map((r) => ({
    ...r,
    detail: saysLeft(r.detail),
  }));
  const refills = shown.find((r) => r.refills)?.refills ?? null;
  const details = shown.map((r) => r.detail).join(" and ");
  return {
    line: `On your ${label} account: ${details}${refills ? ` · refills ${refills}` : ""}.`,
    short: shown[0]!.detail,
    spent: false,
  };
}

/**
 * "840 of 1,000 requests today" reads as well as spent as left; on a line about
 * the person's own account it must say which. The pool's rows sit under a
 * "left" heading and do not need the word.
 */
function saysLeft(detail: string): string {
  if (/\bleft\b/.test(detail)) return detail;
  // A counter whose window the vendor never named ("7,200 of 7,200
  // requests") must still say which way it reads — it shipped without the
  // word on 2026-10-21 and could be read as all spent or all left.
  if (/ (today|this minute)$/.test(detail))
    return detail.replace(/ (today|this minute)$/, " left $1");
  return `${detail} left`;
}
