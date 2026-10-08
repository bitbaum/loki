/**
 * The conversation with Loki, as data — kept pure so it is tested without a
 * browser (scripts/test/widget-thread.ts).
 *
 * The panel used to be three tools in one box: a report form, an "Ask Loki"
 * advisor and a studio chat, each with its own history that vanished on close.
 * Now there is one thread. You talk to Loki; Loki answers; anything worth
 * building is sent to the builder FROM the thread, and the "sent" receipt
 * lands in it too. It is kept per tab (sessionStorage), so the conversation
 * survives the site's own page loads — on a multi-page site, every link click
 * used to wipe it.
 *
 * Restored items are untrusted input (anything can write sessionStorage on
 * the host page), so restoring validates every field and caps every string.
 */

export type Speaker = "loki" | "cat";
export type Link = { label: string; url: string };

export type ThreadItem =
  | { kind: "you"; at: number; text: string }
  | {
      kind: "loki";
      at: number;
      text: string;
      speaker?: Speaker;
      /** Changes Loki recommends — each one tap from the builder. */
      changes?: string[];
      links?: Link[];
      /** No model could answer; the question itself can still be sent. */
      degraded?: boolean;
    }
  | {
      kind: "sent";
      at: number;
      text: string;
      /** The owner's note starts a build; a visitor's waits for the builder. */
      owner: boolean;
      building?: boolean;
      note?: string;
      claimUrl?: string;
    };

/** Enough to read back a visit; small enough for sessionStorage and a prompt. */
export const THREAD_MAX = 40;
/** A thread older than this belongs to an earlier visit. */
export const THREAD_MAX_AGE_MS = 2 * 60 * 60_000;
const TEXT_MAX = 6000;
const CHANGE_MAX = 300;

export function pushItem(thread: ThreadItem[], item: ThreadItem): ThreadItem[] {
  return [...thread, item].slice(-THREAD_MAX);
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : null;

/** Only http(s) links ever become anchors on someone else's site. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Validate one stored item; null drops it. */
function restoreItem(raw: unknown, now: number): ThreadItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at =
    typeof r.at === "number" && r.at <= now && now - r.at <= THREAD_MAX_AGE_MS ? r.at : null;
  const text = str(r.text, TEXT_MAX);
  if (at === null || text === null) return null;
  if (r.kind === "you") return { kind: "you", at, text };
  if (r.kind === "loki") {
    const changes = Array.isArray(r.changes)
      ? r.changes
          .map((c) => str(c, CHANGE_MAX))
          .filter((c): c is string => !!c)
          .slice(0, 5)
      : [];
    const links = Array.isArray(r.links)
      ? r.links
          .map((l) => {
            const o = (l ?? {}) as Record<string, unknown>;
            const url = safeHttpUrl(o.url);
            const label = str(o.label, 80);
            return url && label ? { label, url } : null;
          })
          .filter((l): l is Link => !!l)
          .slice(0, 5)
      : [];
    return {
      kind: "loki",
      at,
      text,
      speaker: r.speaker === "cat" ? "cat" : "loki",
      ...(changes.length ? { changes } : {}),
      ...(links.length ? { links } : {}),
      ...(r.degraded === true ? { degraded: true } : {}),
    };
  }
  if (r.kind === "sent") {
    const claimUrl = safeHttpUrl(r.claimUrl);
    const note = str(r.note, 500);
    return {
      kind: "sent",
      at,
      text,
      owner: r.owner === true,
      ...(r.building === true ? { building: true } : {}),
      ...(note ? { note } : {}),
      ...(claimUrl ? { claimUrl } : {}),
    };
  }
  return null;
}

export function restoreThread(raw: unknown, now: number): ThreadItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => restoreItem(r, now))
    .filter((i): i is ThreadItem => !!i)
    .slice(-THREAD_MAX);
}

/**
 * The thread as model history: what was said, in order, as user/assistant
 * turns. "Sent" receipts are said back as Loki's words, so a follow-up like
 * "and the footer too" knows what has already gone to the builder.
 */
export function historyFor(
  thread: ThreadItem[],
  maxTurns: number,
  maxChars: number,
): { role: "user" | "assistant"; content: string }[] {
  return thread
    .map((i) =>
      i.kind === "you"
        ? { role: "user" as const, content: i.text }
        : i.kind === "loki"
          ? { role: "assistant" as const, content: i.text }
          : { role: "assistant" as const, content: `(Sent to the builder: ${i.text})` },
    )
    .slice(-maxTurns)
    .map((t) => ({ ...t, content: t.content.slice(0, maxChars) }));
}

/** Which assistant answers in the thread. */
export type Assistant = "advisor" | "concierge" | "none";

/**
 * The owner always gets the site advisor — it is their site, and Review
 * answers there. Otherwise the embed decides: a studio front desk
 * (`data-fc-modes` lists chat) gets the concierge; the default gets the
 * advisor; `data-fc-modes="report"` opts out of AI and messages go straight
 * to the builder.
 */
export function assistantFor(modes: readonly string[], owner: boolean): Assistant {
  if (owner) return "advisor";
  if (modes.includes("chat")) return "concierge";
  if (modes.includes("ask")) return "advisor";
  return "none";
}
