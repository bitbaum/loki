/**
 * Vendor counters, rendered as something an operator can act on.
 *
 * Pure — no database, no clock beyond what it is handed — so the wording is
 * testable without standing up either.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
 *
 * A number that does not imply an action is decoration. "78%" tells you nothing
 * you can do. "About 40 more answers, then it moves to OpenRouter" tells you
 * whether to care.
 *
 * So every row carries three things and not one: what is left, in the unit a
 * person thinks in; when it comes back; and what happens next when it runs out.
 *
 * ── THREE STATES, NEVER TWO ──────────────────────────────────────────────────
 *
 * known · unknown · exhausted.
 *
 * A vendor nobody has called today has NO reading, and rendering that as a full
 * tank is the same mistake as trusting a provider's usage endpoint — which was
 * measured reporting an untouched allowance while the key was locked out.
 * Rendering it as empty invents an outage. It is drawn as unknown, and the
 * reason it is unknown is stated.
 */

/** One vendor counter as the UI needs it. */
export type QuotaRowView = {
  provider: string;
  model: string;
  state: "known" | "unknown" | "exhausted" | "skipped";
  /** What is left, in answers where that is knowable. Null when unknown. */
  answers: number | null;
  /** The raw figure, for the reader who wants it. */
  detail: string;
  /** When it refills, in words. Null when the vendor did not say. */
  refills: string | null;
  /** What happens when this one is spent — the actionable half. */
  consequence: string;
  /** 0..1 for a gauge, or null when there is nothing to draw a level against. */
  level: number | null;
  /** Whether this row should draw attention. */
  urgent: boolean;
  /** The other counters measured for this same model, phrased for a subtitle. */
  alsoMetered?: string[];
  /** When this counter was read, so a stale row cannot outrank a fresh one. */
  observedAt?: number | null;
  /**
   * What one unit of this counter IS, for the label. "answers" for a chat model;
   * a transcription model serves transcriptions, and calling those answers is a
   * small lie in the unit — the kind that makes a reader distrust the number
   * beside it.
   */
  unitNoun?: string;
  /**
   * Blocking, but NOT empty: something is left, just less than one answer
   * costs. "Spent" beside "3,984 of 8,000" is the kind of line that gets a
   * dashboard called made-up, so this state gets its own word.
   */
  shortfall?: boolean;
};

export type QuotaReadingRow = {
  provider: string;
  model: string;
  scope: string;
  window: string;
  quotaLimit: number | null;
  remaining: number;
  resetAt: Date | string | null;
  observedAt: Date | string;
  /** Header name, "429", or "preflight" — the last is a skip, not a measurement. */
  source?: string;
  /** Why this row reads as it does, when a number alone would mislead. */
  note?: string | null;
};

/** Below this fraction of the ceiling, a row earns attention. */
const URGENT_AT = 0.2;
/**
 * A reading older than this is stale enough that the counter has probably
 * refilled without us hearing. Per-minute windows go stale in minutes; a day
 * counter is good until its reset.
 */
const STALE_MINUTE_MS = 5 * 60 * 1000;

/**
 * Measured cost of one Loki turn, for translating tokens into answers.
 *
 * A guess stated as a guess. The `turns` column on ai_spend exists so this can
 * become a query over reality rather than a constant; until there is enough
 * traffic to compute a mean, a round number the reader can sanity-check beats a
 * precise-looking one nobody measured.
 */
export const TOKENS_PER_ANSWER = 6000;

function ms(v: Date | string | null): number | null {
  if (v === null) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** "in 4 hours", "in 12 minutes", "now". Null when the vendor did not say. */
export function refillsIn(resetAt: Date | string | null, now: number): string | null {
  const at = ms(resetAt);
  if (at === null) return null;
  const delta = at - now;
  if (delta <= 0) return "now";
  // Tested against the raw delta, not the rounded minutes: 40 seconds rounds
  // UP to 1, so a rounded check never reaches this branch and the sub-minute
  // case silently reads as "in 1 minute".
  if (delta < 60_000) return "in under a minute";
  const mins = Math.round(delta / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Render one counter.
 *
 * `nextProvider` is what the chain would fall to — the consequence half. When
 * there is nothing after this link, say so plainly rather than implying a
 * safety net that does not exist.
 */
export function describeQuota(
  row: QuotaReadingRow,
  opts: { now: number; nextProvider: string | null; tokensPerAnswer?: number },
): QuotaRowView {
  const perAnswer = opts.tokensPerAnswer ?? TOKENS_PER_ANSWER;
  const observed = ms(row.observedAt);
  const stale =
    row.window === "minute" && observed !== null && opts.now - observed > STALE_MINUTE_MS;

  // A skip is not a measurement, and reporting it as one inverts the meaning:
  // a healthy vendor that is never reached would read as an exhausted one. This
  // branch comes FIRST because `remaining` is 0 on these rows purely to satisfy
  // a non-null column, and every check below reads 0 as empty.
  if (row.source === "preflight") {
    return {
      provider: row.provider,
      model: row.model,
      state: "skipped",
      answers: null,
      detail: row.note ?? "skipped without being called — the prompt exceeded its budget",
      refills: null,
      // The consequence is not "wait": waiting changes nothing. Say what would.
      consequence: "shorten the prompt or raise its budget, or this vendor is never used",
      level: null,
      observedAt: observed,
      // Loud on purpose. A provider silently walked past on every turn is
      // capacity paid for and never spent.
      urgent: true,
    };
  }

  const answers =
    row.scope === "requests"
      ? Math.max(0, Math.floor(row.remaining))
      : Math.max(0, Math.floor(row.remaining / perAnswer));

  // Derived from the model id because that is all the meter records: a reading
  // carries a vendor's counter, not our registry's notion of "chat" vs
  // "transcribe". Wrong-but-harmless if a future chat model is called whisper;
  // silently mislabelled units are the thing being avoided.
  const unitNoun = /whisper/i.test(row.model) ? "transcriptions" : "answers";
  const unit = row.scope === "requests" ? "requests" : "tokens";
  const per = row.window === "day" ? " today" : row.window === "minute" ? " this minute" : "";
  const detail =
    row.quotaLimit === null
      ? `${row.remaining.toLocaleString("en-US")} ${unit} left${per}`
      : `${row.remaining.toLocaleString("en-US")} of ${row.quotaLimit.toLocaleString("en-US")} ${unit}${per}`;

  const consequence = opts.nextProvider
    ? `then it moves to ${opts.nextProvider}`
    : "this is the last link — after it, answers wait for the reset";

  // A per-minute counter read five minutes ago says nothing about now. Reporting
  // it as current is how a dashboard ends up confidently wrong.
  if (stale) {
    return {
      provider: row.provider,
      model: row.model,
      state: "unknown",
      answers: null,
      detail: "not measured recently — this counter refills every minute",
      refills: null,
      consequence,
      level: null,
      urgent: false,
      observedAt: observed,
    };
  }

  const empty = row.remaining <= 0;
  // Under one answer's worth is still blocking — the turn cannot be served from
  // this window — but it is a different fact from an empty tank, and it recovers
  // differently: a minute window with 3,984 left refills in seconds.
  const shortfall = !empty && row.scope === "tokens" && answers === 0;
  const exhausted = empty || shortfall;
  const shortfallDetail = shortfall ? `${detail} — under one answer's worth` : detail;
  const level =
    row.quotaLimit && row.quotaLimit > 0
      ? Math.max(0, Math.min(1, row.remaining / row.quotaLimit))
      : null;

  return {
    provider: row.provider,
    model: row.model,
    state: exhausted ? "exhausted" : "known",
    answers,
    unitNoun,
    detail: shortfallDetail,
    ...(shortfall ? { shortfall: true } : {}),
    refills: refillsIn(row.resetAt, opts.now),
    consequence,
    level,
    urgent: exhausted || (level !== null && level <= URGENT_AT),
    observedAt: observed,
  };
}

/**
 * A vendor we hold a key for but have not heard from.
 *
 * This row exists so the absence is VISIBLE. Omitting the provider entirely
 * would let a reader assume the list is the whole fleet, and silently drop the
 * one that is about to serve their next turn.
 */
export function unknownQuota(
  provider: string,
  reason: string,
  /**
   * What happens next. The default promises a future measurement, which is
   * true for a vendor we simply have not called and FALSE for one that
   * publishes no limits at all — it will never be measured, however long you
   * wait, so saying so is the only honest row.
   */
  consequence = "will be measured on the next answer it serves",
): QuotaRowView {
  return {
    provider,
    model: "—",
    state: "unknown",
    answers: null,
    detail: reason,
    refills: null,
    consequence,
    level: null,
    urgent: false,
  };
}

/**
 * The one-line summary for the top of the page.
 *
 * Leads with what is actionable. If something is spent, that is the headline;
 * if everything is unknown, say THAT rather than implying health nobody checked.
 */
/**
 * One model, one row: the counter that actually stops you.
 *
 * A vendor meters several things at once. Groq meters three — tokens per
 * minute, requests per day, and a daily token pool that only its refusals
 * mention — and on 2026-09-13 two of them read healthy while the third was the
 * reason every question returned a 503.
 *
 * Listing all three side by side is not more honest, it is less. It invites the
 * reader to average them, and the answer to "can I use this right now" is not
 * an average: it is the worst counter. Three bars per model also inflated the
 * "(of N configured)" tail into counting COUNTERS as PROVIDERS, which is how a
 * page with two vendors announced five.
 *
 * So the counters are ranked by how hard they are blocking and the leader is
 * shown, with the rest named underneath so nothing measured is hidden.
 *
 * (It also gives each rendered row a unique provider+model identity. They were
 * not unique before, and React was keying two Groq counters the same.)
 */
const BINDING_ORDER: Record<QuotaRowView["state"], number> = {
  // Spent is the one stopping you now.
  exhausted: 0,
  // Never reached is the next most useful, and unlike "unknown" it has a cause
  // the operator can act on.
  skipped: 1,
  // Measured and usable — among these, least headroom leads.
  known: 2,
  // Says nothing about now, so it can never outrank something that does.
  unknown: 3,
};

export function bindingRows(views: QuotaRowView[]): QuotaRowView[] {
  const byModel = new Map<string, QuotaRowView[]>();
  for (const v of views) {
    const key = `${v.provider}:${v.model}`;
    const list = byModel.get(key);
    if (list) list.push(v);
    else byModel.set(key, [v]);
  }

  const out: QuotaRowView[] = [];
  for (const group of byModel.values()) {
    // A skip says "at time T we did not call this". A reading taken LATER is
    // that statement being overtaken by events, and the skip row is never
    // rewritten — it is only replaced by another skip. So without this, raising
    // the budget that caused the skip would fix the provider and leave the page
    // insisting it is still never reached, which is the shape of complaint this
    // whole surface exists to answer.
    const newestReading = group.reduce(
      (max, r) =>
        r.state !== "skipped" && r.observedAt != null ? Math.max(max, r.observedAt) : max,
      Number.NEGATIVE_INFINITY,
    );
    const live = group.filter(
      (r) => !(r.state === "skipped" && r.observedAt != null && r.observedAt < newestReading),
    );

    const ranked = [...(live.length > 0 ? live : group)].sort((a, b) => {
      const byState = BINDING_ORDER[a.state] - BINDING_ORDER[b.state];
      if (byState !== 0) return byState;
      // Within a state, the tighter counter leads. A null level cannot be
      // compared, so it sorts last rather than pretending to be zero.
      const al = a.level ?? Number.POSITIVE_INFINITY;
      const bl = b.level ?? Number.POSITIVE_INFINITY;
      return al - bl;
    });
    const [lead, ...rest] = ranked;
    if (!lead) continue;
    // Only real MEASUREMENTS go in the subtitle. A skip notice is not a counter
    // (and repeating its sentence under a row that already says the same thing
    // is noise dressed as detail), and a stale counter is not a measurement —
    // its wording does not even name which counter it is talking about.
    const also = rest
      .filter((r) => r.state === "known" || r.state === "exhausted")
      .map((r) => r.detail);
    out.push(also.length === 0 ? lead : { ...lead, alsoMetered: also });
  }
  return out;
}

export function summarise(rows: QuotaRowView[]): string {
  if (rows.length === 0) return "No AI providers are configured.";
  const known = rows.filter((r) => r.state === "known");
  const exhausted = rows.filter((r) => r.state === "exhausted" && !r.shortfall);
  // Counted apart from "spent": the tank is not empty, it is merely too low for
  // one more answer, and it refills on a completely different timescale.
  const tooLow = rows.filter((r) => r.shortfall);
  const skipped = rows.filter((r) => r.state === "skipped");
  const unknown = rows.filter((r) => r.state === "unknown");

  // Count out of the TOTAL, always. The first version said "every measured
  // provider is spent" while exactly one of two had been measured — true, and
  // read as evasion, because it quietly redefined "every" to mean "the one".
  const of = ` (of ${rows.length} configured)`;
  const parts: string[] = [];

  if (known.length > 0) {
    const total = known.reduce((n, r) => n + (r.answers ?? 0), 0);
    parts.push(`about ${total.toLocaleString("en-US")} more answer${total === 1 ? "" : "s"}`);
  }
  if (exhausted.length > 0) {
    const back = exhausted.find((r) => r.refills)?.refills;
    parts.push(`${exhausted.length} spent${back ? `, back ${back}` : ""}`);
  }
  // Named before "not measured", because a skip is a fixable fault and an
  // unmeasured provider is merely quiet.
  if (tooLow.length > 0) {
    const back = tooLow.find((r) => r.refills)?.refills;
    parts.push(`${tooLow.length} too low for another answer${back ? `, back ${back}` : ""}`);
  }
  if (skipped.length > 0) {
    parts.push(`${skipped.length} never reached — prompts exceed their budget`);
  }
  if (unknown.length > 0) parts.push(`${unknown.length} not measured yet`);

  const head = parts.length > 0 ? parts.join(" · ") : "nothing measured yet";
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}${of}.`;
}

/**
 * Say a consequence once, not once per model.
 *
 * OpenRouter carries five models, so "this is the last link — after it, answers
 * wait for the reset" printed five times in a column, burying the rows that said
 * something different. The fact is per-PROVIDER; repeating it per model does not
 * make it truer, it just costs the reader the contrast that made the page
 * scannable.
 *
 * Blanks a consequence only when the row directly above already said the same
 * words, so a repeat that returns later still speaks.
 */
export function dedupeConsequences(rows: QuotaRowView[]): QuotaRowView[] {
  let previous = "";
  return rows.map((row) => {
    const same = row.consequence === previous;
    previous = row.consequence;
    return same ? { ...row, consequence: "" } : row;
  });
}
