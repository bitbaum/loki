/**
 * The event scout — search the web, turn results into dated candidates, and
 * hand the survivors to the approval queue as things the operator can accept
 * with one tap.
 *
 * WHY IT LOOKS LIKE THIS
 *
 * 1. SEARCH COMES FROM ai-kit/web, NOT FROM HERE. That package already owns the
 *    backend chain (self-hosted searxng → brave → tavily), the SSRF-safe reader,
 *    and — the part that matters — a THREE-valued answer. `could_not_look` is
 *    not `nothing`: a dead backend must never be reported as "there are no
 *    events in Zurich this week". Hand-rolling a fetch here would have quietly
 *    reinvented that bug (fleet/SHARED.md is explicit: do not write the second
 *    one).
 *
 * 2. ONE MODEL CALL PER RUN, NOT ONE PER RESULT. Extraction has to be a model —
 *    search snippets carry dates as prose, in two languages — but the operator's
 *    AI budget is rationed and shared across ten apps, so per-result extraction
 *    would spend a day's allowance on one digest. Every snippet from every topic
 *    goes into a single batched call instead.
 *
 * 3. THE MODEL IS NOT TRUSTED ABOUT TIME. It is told today's date and told to
 *    omit anything it cannot date; whatever comes back is then screened again
 *    in pure code (lib/events/candidate.ts), which drops undated, past and
 *    out-of-horizon entries regardless of what the model claimed. The first
 *    search run while building this had a September 2025 meetup as its top hit.
 *
 * 4. SUGGESTIONS ARRIVE AS DRAFTS, NOT AS A NEWSLETTER. A suggestion the
 *    operator can only read is a chore; a suggestion with an Approve button is
 *    the decision itself, and approving books it. That machinery already exists
 *    and is already proven, so the scout's whole delivery story is "write a
 *    draft and let the queue do its job".
 */
import { webSearch } from "@bitbaum/ai-kit/web";
import { callGroqText } from "@/lib/groq";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import {
  SCOUT_TOPICS,
  SCOUT_MAX_SUGGESTIONS,
  SCOUT_HORIZON_DAYS,
  SCOUT_RESULTS_PER_TOPIC,
} from "@/config/event-scout";
import {
  screenCandidates,
  dedupeKey,
  type EventCandidate,
  type ScreenedEvent,
} from "@/lib/events/candidate";

/** One search result, tagged with the topic that found it. */
type TaggedResult = {
  title: string;
  url: string;
  snippet: string;
  category: string;
  rationale: string;
};

export type ScoutOutcome =
  | { status: "suggestions"; events: ScreenedEvent[]; searched: number; extracted: number }
  /** Backends answered; there was genuinely nothing worth proposing. */
  | { status: "nothing"; searched: number }
  /** No backend answered at all. NOT the same as nothing, and never reported as it. */
  | { status: "could_not_look"; detail: string };

/**
 * Run every configured topic and collect the results.
 *
 * A topic that fails is skipped, not fatal — one refused backend on one query
 * should cost that query, not the digest. But if NO topic managed to look at
 * all, that is reported as `could_not_look`, because a silent empty digest week
 * after week is how an expired key hides for a month.
 */
async function gather(): Promise<{ results: TaggedResult[]; looked: number; detail: string[] }> {
  const results: TaggedResult[] = [];
  const detail: string[] = [];
  let looked = 0;

  for (const topic of SCOUT_TOPICS) {
    try {
      const found = await webSearch(topic.query, {
        limit: SCOUT_RESULTS_PER_TOPIC,
        // Swiss listings are as often German as English, and the engines
        // weight the hint rather than filter on it — so this widens what is
        // reachable rather than narrowing it.
        lang: "de-CH",
      });
      if (found.status === "could_not_look") {
        detail.push(`${topic.key}: could not look`);
        continue;
      }
      looked++;
      if (found.status === "nothing") continue;
      for (const r of found.results.slice(0, SCOUT_RESULTS_PER_TOPIC)) {
        results.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          category: topic.category,
          rationale: topic.rationale,
        });
      }
    } catch (err) {
      detail.push(`${topic.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { results, looked, detail };
}

/**
 * One batched call: search results in, dated events out.
 *
 * The prompt's whole job is to make OMISSION the easy path. A model asked to
 * extract events from listings will happily invent a plausible date for
 * anything undated, and a plausible date is exactly the failure that puts a
 * finished event in next week's digest.
 */
async function extract(results: TaggedResult[], now: Date): Promise<EventCandidate[]> {
  if (results.length === 0) return [];

  const system = `You turn web search results into calendar events. Reply with ONE JSON array and nothing else.

Each element: {"title":"...","startsAt":"<RFC3339 with offset, or YYYY-MM-DD if no time is given>","endsAt":"<same, or omit>","location":"<venue or city, or omit>","url":"<the result url>","index":<the 0-based index of the result it came from>}

RULES, in order of importance:
1. OMIT any result whose date you cannot determine from its own text. Do not infer, do not use "upcoming", do not guess a weekday. An omission is always correct; an invented date is never.
2. OMIT anything dated before ${now.toISOString().slice(0, 10)}. Listings pages keep old events online.
3. OMIT anything that is not a specific, attendable event: no venue homepages, no ticket vendors, no "what's on in Zurich" roundups, no recurring "every Tuesday" without a concrete date.
4. Resolve dates against the current date given below and output absolute values with the Swiss offset (+02:00 in summer, +01:00 in winter).
5. Keep the title as the event is actually called. Do not translate it.`;

  const lines = results
    .map((r, i) => `[${i}] ${r.title}\n${r.url}\n${r.snippet}`.slice(0, 600))
    .join("\n\n");

  let raw: string;
  try {
    raw = await callGroqText(`Current date: ${now.toISOString()}\n\nResults:\n${lines}`, {
      feature: "event-scout",
      systemPrompt: system,
      maxTokens: 2000,
      temperature: 0,
      timeoutMs: HTTP_TIMEOUT_LONG_MS,
    });
  } catch {
    return [];
  }

  const s = raw.indexOf("[");
  const e = raw.lastIndexOf("]");
  if (s === -1 || e <= s) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return parsed.flatMap((item): EventCandidate[] => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const title = str(o.title);
    if (!title) return [];
    // Carry the CATEGORY and RATIONALE from the topic that found it rather than
    // letting the model author them: the "why this is worth your evening" line
    // is the operator's own stated taste (config/event-scout.ts), not something
    // a language model should be improvising per item.
    const idx = typeof o.index === "number" ? o.index : -1;
    const src = results[idx] ?? results[0];
    return [
      {
        title,
        startsAt: str(o.startsAt),
        endsAt: str(o.endsAt),
        location: str(o.location),
        url: str(o.url) ?? src?.url,
        category: src?.category ?? "event",
        rationale: src?.rationale ?? "",
      },
    ];
  });
}

/**
 * Find events worth suggesting.
 *
 * `seenKeys` carries everything already proposed OR rejected — the caller reads
 * it from the action queue, which is the memory. A rejection is permanent by
 * design: the operator saying no to a category of thing should not have to say
 * it again every week.
 */
export async function scoutEvents(opts: {
  seenKeys: Set<string>;
  now?: Date;
  max?: number;
}): Promise<ScoutOutcome> {
  const now = opts.now ?? new Date();
  const { results, looked, detail } = await gather();

  if (looked === 0) {
    return {
      status: "could_not_look",
      detail: detail.slice(0, 4).join("; ") || "no search backend answered",
    };
  }
  if (results.length === 0) return { status: "nothing", searched: looked };

  const candidates = await extract(results, now);
  const events = screenCandidates({
    candidates,
    now,
    horizonDays: SCOUT_HORIZON_DAYS,
    seenKeys: opts.seenKeys,
    max: opts.max ?? SCOUT_MAX_SUGGESTIONS,
  });

  if (events.length === 0) return { status: "nothing", searched: looked };
  return { status: "suggestions", events, searched: looked, extracted: candidates.length };
}

export { dedupeKey };
