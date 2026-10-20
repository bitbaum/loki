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
      /** A project member's own note (their pass): `note` is what happened. */
      member?: boolean;
      building?: boolean;
      savedOnly?: boolean;
      note?: string;
      claimUrl?: string;
      /** Sent about the widget itself, to Loki's own team (self-report.ts). */
      toLoki?: boolean;
      /** Several changes filed at once (a spoken note's list): `text` holds
       *  them one per line. */
      changes?: number;
    }
  | {
      /** Watch spoke up on its own: something it saw while the owner used
       *  the site (watch-trail.ts explainNotice). */
      kind: "noticed";
      at: number;
      text: string;
      /** The change request "Fix this" sends. */
      fix: string;
      /** It broke outright and a fix was already started — nothing to tap. */
      filed?: boolean;
      /** The remark's signature (watch-trail.ts) — what "Fix this" files, and
       *  what the card's status is looked up by (known-fixes.ts). */
      key?: string;
      /** Loki fixed this before and it is back. */
      again?: boolean;
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

/** A remark's key that marks Loki's own unasked READ of a page (watch.ts). */
export const isPageReadKey = (key: string | undefined): boolean => !!key?.endsWith("|read");

/**
 * Add Loki's unasked read of a page, replacing any earlier one. Reads are
 * about the page the owner is on; four of them stacked above the owner's own
 * words (one per page browsed) buried the conversation they came to have
 * (operator's phone, 2026-10-15). An earlier read loses nothing: a fix it
 * started is tracked under Your changes, and the page is read again on the
 * next visit.
 */
export function pushPageRead(thread: ThreadItem[], item: ThreadItem): ThreadItem[] {
  const kept = thread.filter((i) => !(i.kind === "noticed" && isPageReadKey(i.key)));
  return pushItem(kept, item);
}

/**
 * The card a remark belongs to. A page's checks own ONE card (its newest
 * reading, watch-trail.ts checksSlot); everything else is its own remark.
 */
export function noticeSlot(key: string | undefined): string | null {
  if (!key) return null;
  const at = key.indexOf("|checks|");
  return at >= 0 ? key.slice(0, at + "|checks".length) : key;
}

type Noticed = Extract<ThreadItem, { kind: "noticed" }>;

/**
 * Add something Watch noticed — or update the card that already says it.
 * Remarks used to be appended, so one page's checks taken three times were
 * three cards, and two readings of a form ("1 field", "2 fields") two
 * (operator's phone, 2026-10-20). Now a remark whose slot already has a card
 * replaces that card where it stands, and one whose words are already on
 * screen is not said again. Reads keep their own rule (pushPageRead).
 */
export function pushNoticed(thread: ThreadItem[], item: Noticed): ThreadItem[] {
  if (isPageReadKey(item.key)) return pushPageRead(thread, item);
  const slot = noticeSlot(item.key);
  const same = (i: ThreadItem): i is Noticed =>
    i.kind === "noticed" && ((!!slot && noticeSlot(i.key) === slot) || i.text === item.text);
  const at = thread.findIndex(same);
  if (at < 0) return pushItem(thread, item);
  const prev = thread[at] as Noticed;
  if (prev.text === item.text && prev.key === item.key && prev.filed === item.filed) return thread;
  return thread.flatMap((i, n): ThreadItem[] => (n === at ? [item] : same(i) ? [] : [i]));
}

/** Take back the card a slot owns: the newest reading of that page found
 *  nothing, so the older one is no longer true. */
export function dropNoticed(thread: ThreadItem[], slot: string): ThreadItem[] {
  const next = thread.filter((i) => !(i.kind === "noticed" && noticeSlot(i.key) === slot));
  return next.length === thread.length ? thread : next;
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
      ...(r.member === true ? { member: true } : {}),
      ...(r.building === true ? { building: true } : {}),
      ...(r.savedOnly === true ? { savedOnly: true } : {}),
      ...(r.toLoki === true ? { toLoki: true } : {}),
      ...(typeof r.changes === "number" &&
      Number.isInteger(r.changes) &&
      r.changes > 1 &&
      r.changes <= 50
        ? { changes: r.changes }
        : {}),
      ...(note ? { note } : {}),
      ...(claimUrl ? { claimUrl } : {}),
    };
  }
  if (r.kind === "noticed") {
    const fix = str(r.fix, 1000);
    if (!fix) return null;
    const key = str(r.key, 300);
    return {
      kind: "noticed",
      at,
      text,
      fix,
      ...(r.filed === true ? { filed: true } : {}),
      ...(key ? { key } : {}),
      ...(r.again === true ? { again: true } : {}),
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
          : i.kind === "noticed"
            ? { role: "assistant" as const, content: `(Noticed while watching: ${i.text})` }
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
