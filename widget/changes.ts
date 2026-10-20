/**
 * "Your changes" — the loop closing on the owner's own site.
 *
 * Until now the panel's story ended at "On it — Loki tells you when", and on
 * the site Loki never did: the telling went to a push notification and a
 * Telegram chat, and the page the owner came back to said nothing. This strip
 * is the other half of that sentence. It lists what the owner asked for and
 * where each thing is (Building · On its way · Live · Needs you), asks Loki
 * again every half minute while something is moving, and when a change goes
 * live since the last look, Loki says so — in the thread when the panel is
 * open, beside the launcher when it is not — with one tap to see it.
 *
 * Words come from the server (owner-view.ts). This side renders, remembers
 * what it has already seen (localStorage, per site), and notices the one
 * transition that matters.
 */
import { h } from "./dom";
import { knownFor, parseKnown, type KnownFix } from "./known-fixes";
import { isThemePreference, type ThemePreference } from "./theme-mode";

export type OwnerChange = {
  id: string;
  text: string;
  at: string;
  label: string;
  tone: "neutral" | "accent" | "warning" | "positive";
  detail: string;
  live: boolean;
  settled: boolean;
  href: string | null;
  action: string | null;
  /** Waiting on the owner's decision — a saved note, one not started, a
   *  failed attempt (owner-view.ts). The one thing the header counts. */
  needsYou: boolean;
};

/** Mirrors OWNER_CHANGES_MAX in src/lib/feedback/owner-view.ts. */
export const CHANGES_MAX = 12;
/** Rows shown before "all N in Loki". The strip sits above the thread. */
export const CHANGES_SHOWN = 3;
export const CHANGES_POLL_MS = 30_000;
/** Stop asking after this long with nothing moving — a tab left open all day
 *  must not poll Loki all day. */
export const CHANGES_POLL_FOR_MS = 2 * 60 * 60_000;

const seenKey = (token: string) => `loki-changes-seen:${token}`;

/** What this browser last saw of each change: live or not. */
export function readSeen(token: string): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey(token)) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeSeen(token: string, seen: Record<string, boolean>): void {
  try {
    localStorage.setItem(seenKey(token), JSON.stringify(seen));
  } catch {
    /* storage blocked: the announcement may repeat next visit */
  }
}

/**
 * The changes that went live since the last look. A change never seen before
 * is not announced — the first open after a long absence should not shout
 * about everything that ever shipped — only one this browser saw building.
 */
export function newlyLive(
  prev: Record<string, boolean>,
  next: readonly OwnerChange[],
): OwnerChange[] {
  return next.filter((c) => c.live && prev[c.id] === false);
}

export function toSeen(next: readonly OwnerChange[]): Record<string, boolean> {
  return Object.fromEntries(next.map((c) => [c.id, c.live]));
}

/**
 * The collapsed line: what is moving and what landed, in the order the owner
 * cares — what needs them, what is being built, what is waiting its turn,
 * what is live. "Your changes · 1 needs you · 1 building · 2 live".
 */
export function changesSummary(
  changes: readonly OwnerChange[],
  visitors = 0,
  waiting: Waiting = {},
): string {
  const count = (label: string) => changes.filter((c) => c.label === label).length;
  const parts: Array<[number, string, string]> = [
    [needsYouCount(changes, waiting), "needs you", "need you"],
    [count("Building") + count("Starting"), "building", "building"],
    [count("In line"), "in line", "in line"],
    [count("On its way"), "on its way", "on their way"],
    [changes.filter((c) => c.live).length, "live", "live"],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (visitors) said.push(`${visitors} from visitors`);
  return said.length ? `Your changes · ${said.join(" · ")}` : `Your changes · ${changes.length}`;
}

/** What waits on the owner beyond the rows the list carries. */
export type Waiting = {
  /** The server's count of every row that needs the owner — past the twelve
   *  rows it sends, too (api/widget/owner/changes). */
  total?: number;
  /** Changes said on the open card and not saved yet. */
  unsaved?: number;
};

/**
 * How many things wait on the owner's decision: saved notes, notes not
 * started, failed attempts, and changes said but not saved. The ONLY number
 * the header shows.
 */
export function needsYouCount(changes: readonly OwnerChange[], waiting: Waiting = {}): number {
  const rows = changes.filter((c) => c.needsYou).length;
  return Math.max(rows, waiting.total ?? 0) + (waiting.unsaved ?? 0);
}

/**
 * The one fragment the panel's status line carries about changes: how many
 * need the owner, and nothing else. It used to fall back to "2 being built",
 * "4 changes live"… and before that counted only failed attempts inside a
 * window of the newest twelve, so the line said "9 changes need you" over a
 * list that showed none of them, then 6 with nothing done (2026-10-20).
 * Empty when nothing needs the owner: the line then says just "Watching".
 */
export function changesHeadline(changes: readonly OwnerChange[], waiting: Waiting = {}): string {
  const n = needsYouCount(changes, waiting);
  return n ? `${n} ${n === 1 ? "change needs you" : "changes need you"}` : "";
}

/**
 * The owner's saved notes — said while Loki watched, kept for later. The
 * server's word for them is "Review note" (src/lib/feedback/owner-view.ts);
 * "Build them" starts every one (api/widget/owner/build).
 */
export const SAVED_NOTE_LABEL = "Review note";
export const savedNotes = (changes: readonly OwnerChange[]): number =>
  changes.filter((c) => c.label === SAVED_NOTE_LABEL).length;

/** What "Build them" said, in one sentence for the conversation. */
export function builtSay(r: {
  started: number;
  total: number;
  builds?: number;
  note?: string;
}): string {
  if (!r.total) return "There are no saved notes waiting.";
  const builds = r.builds ?? r.started;
  if (r.started === r.total)
    return r.total === 1
      ? "Started your saved note — Loki builds it and tells you when it is live."
      : builds === 1
        ? `Started your ${r.total} saved notes as one build — they are all about the same page. Loki tells you when it is live.`
        : `Started your ${r.total} saved notes as ${builds} builds, one per page. Loki tells you as each goes live.`;
  return `Started ${r.started} of ${r.total} saved notes. ${r.note ?? "The rest wait in Loki under Feedback."}`;
}

export function parseChanges(body: unknown): OwnerChange[] {
  const raw = (body as { changes?: unknown })?.changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (c ?? {}) as Partial<OwnerChange>)
    .filter(
      (c) => typeof c.id === "string" && typeof c.text === "string" && typeof c.label === "string",
    )
    .map((c) => ({
      id: c.id as string,
      text: String(c.text).slice(0, 200),
      at: typeof c.at === "string" ? c.at : "",
      label: String(c.label).slice(0, 40),
      tone: (["neutral", "accent", "warning", "positive"] as const).includes(
        c.tone as OwnerChange["tone"],
      )
        ? (c.tone as OwnerChange["tone"])
        : "neutral",
      detail: typeof c.detail === "string" ? c.detail.slice(0, 300) : "",
      live: c.live === true,
      settled: c.settled === true,
      href: typeof c.href === "string" && /^https?:\/\//.test(c.href) ? c.href : null,
      action: typeof c.action === "string" ? c.action.slice(0, 40) : null,
      needsYou: c.needsYou === true,
    }))
    .slice(0, CHANGES_MAX);
}

/** The server's count of rows waiting on the owner (0 when absent). */
export function parseNeedsYou(body: unknown): number {
  const n = (body as { needsYou?: unknown })?.needsYou;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The rows the open list shows: EVERY one that needs the owner, then the
 * newest of the rest up to CHANGES_SHOWN — so the number on the line is
 * always the rows under it.
 */
export function shownChanges(changes: readonly OwnerChange[]): OwnerChange[] {
  const mine = changes.filter((c) => c.needsYou);
  const rest = changes.filter((c) => !c.needsYou);
  return [...mine, ...rest.slice(0, Math.max(0, CHANGES_SHOWN - mine.length))];
}

export function createChanges(opts: {
  apiBase: string;
  token: string;
  pass: () => string | null;
  /** A change went live since this browser last looked. */
  onLive: (change: OwnerChange) => void;
  /** The server no longer honours the pass. */
  onPassRefused: () => void;
  /** The owner's light/dark choice in Loki, each time the server reports it. */
  onTheme?: (pref: ThemePreference) => void;
  /** The list was re-read: cards keyed to a fix follow its status. */
  onUpdate?: () => void;
  /** Drawn again — the status line that carries changesHeadline repaints. */
  onRender?: () => void;
  /** Said in the conversation (what "Build them" started). */
  onSay?: (text: string) => void;
  /** Changes said on the open card and not saved yet (conversation.ts). */
  unsaved?: () => number;
  /** The "not saved yet" row: bring the card into view. */
  onUnsaved?: () => void;
}) {
  // No line of its own: the panel's one status line carries the most urgent
  // fragment ("4 live") and opens this list under it (thoughts-view.ts). It
  // was a header with three rows open all the time, then a second status row.
  const body = h("div", "yours-body");
  const list = h("div", "yours-list");
  const all = h("a", "yours-all");
  all.target = "_blank";
  all.rel = "noopener";
  // Visitors' notes are not the owner's changes; they are counted, and read
  // in Loki, where the inbox has the room to show who said what.
  const visitorsLine = h("a", "yours-visitors");
  visitorsLine.target = "_blank";
  visitorsLine.rel = "noopener";
  visitorsLine.style.display = "none";
  // Record while Loki watches, save, then build them all — one tap.
  const buildBtn = h("button", "yours-build");
  buildBtn.type = "button";
  buildBtn.style.display = "none";
  buildBtn.addEventListener("click", () => void buildSaved());
  body.append(buildBtn, list, all, visitorsLine);

  let changes: OwnerChange[] = [];
  /** Every row waiting on the owner, as the server counted them. */
  let needsYouTotal = 0;
  const waiting = (): Waiting => ({ total: needsYouTotal, unsaved: opts.unsaved?.() ?? 0 });
  /** Every keyed fix the server knows, open or settled (known-fixes.ts). */
  let known: KnownFix[] = [];
  let firstRead: (() => void) | null = null;
  /** Settles after the first answer (or refusal), so Watch can look before it speaks. */
  const ready = new Promise<void>((resolve) => {
    firstRead = resolve;
  });
  let inbox: string | null = null;
  let visitors = 0;
  let timer = 0;
  let startedAt = 0;
  let inflight = false;

  function render() {
    list.textContent = "";
    const saved = savedNotes(changes);
    buildBtn.style.display = saved ? "" : "none";
    if (!buildBtn.disabled)
      buildBtn.textContent =
        saved === 1 ? "Build your saved note" : `Build all ${saved} saved notes`;
    visitorsLine.style.display = visitors && inbox ? "" : "none";
    if (visitors && inbox) {
      visitorsLine.textContent = `${visitors} note${visitors === 1 ? "" : "s"} from visitors, in Loki →`;
      visitorsLine.href = inbox;
    }
    // Said but not saved: it needs the owner too, and its tap is the card.
    const unsaved = opts.unsaved?.() ?? 0;
    if (unsaved) {
      const row = h("button", "yours-row tone-warning");
      row.type = "button";
      row.addEventListener("click", () => opts.onUnsaved?.());
      row.append(
        h("span", "yours-dot"),
        h(
          "span",
          "yours-text",
          unsaved === 1
            ? "1 change you said is not saved yet"
            : `${unsaved} changes you said are not saved yet`,
        ),
        h("span", "yours-status", "Save or discard ↓"),
      );
      list.appendChild(row);
    }
    const shown = shownChanges(changes);
    for (const c of shown) {
      // The row IS the link when there is somewhere to go — no second line.
      const row = c.href
        ? h("a", `yours-row tone-${c.tone}`)
        : h("div", `yours-row tone-${c.tone}`);
      if (row instanceof HTMLAnchorElement && c.href) {
        row.href = c.href;
        row.rel = "noopener";
        row.target = "_blank";
      }
      // The whole request on hover; the row itself wraps to two lines.
      row.title = c.detail ? `${c.text}\n\n${c.detail}` : c.text;
      const text = h("span", "yours-text", c.text);
      // A row waiting on the owner says it is a tap (the row is the link).
      const status = h("span", "yours-status", c.needsYou && c.href ? `${c.label} →` : c.label);
      if (c.needsYou && c.action) row.setAttribute("aria-label", `${c.text} — ${c.action}`);
      row.append(h("span", "yours-dot"), text, status);
      list.appendChild(row);
    }
    const more = changes.length - shown.length;
    all.textContent = more > 0 ? `All ${changes.length} in Loki →` : "Open in Loki →";
    all.style.display = inbox ? "" : "none";
    if (inbox) all.href = inbox;
    opts.onRender?.();
  }

  async function refresh(): Promise<void> {
    const pass = opts.pass();
    if (!pass) {
      firstRead?.();
      firstRead = null;
      return;
    }
    if (inflight) return;
    inflight = true;
    try {
      const res = await fetch(`${opts.apiBase}/api/widget/owner/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: opts.token, ownerPass: pass }),
      });
      const body = (await res.json().catch(() => null)) as {
        owner?: boolean;
        inbox?: unknown;
        visitors?: unknown;
        theme?: unknown;
      } | null;
      if (!res.ok || !body) return;
      if (body.owner === false) {
        opts.onPassRefused();
        return;
      }
      // The mode the owner chose in Loki — the panel follows it (theme-mode.ts).
      if (isThemePreference(body.theme)) opts.onTheme?.(body.theme);
      const next = parseChanges(body);
      known = parseKnown(body);
      needsYouTotal = parseNeedsYou(body);
      opts.onUpdate?.();
      inbox = typeof body.inbox === "string" && /^https?:\/\//.test(body.inbox) ? body.inbox : null;
      visitors =
        typeof body.visitors === "number" && body.visitors > 0 ? Math.floor(body.visitors) : 0;
      const prev = readSeen(opts.token);
      for (const c of newlyLive(prev, next)) opts.onLive(c);
      writeSeen(opts.token, { ...prev, ...toSeen(next) });
      changes = next;
      render();
      // Keep asking only while something can still change.
      if (!next.some((c) => !c.settled)) stop();
    } catch {
      /* Loki unreachable: the strip keeps what it had */
    } finally {
      inflight = false;
      firstRead?.();
      firstRead = null;
    }
  }

  async function buildSaved(): Promise<void> {
    const pass = opts.pass();
    if (!pass || buildBtn.disabled) return;
    buildBtn.disabled = true;
    buildBtn.textContent = "Starting…";
    try {
      const res = await fetch(`${opts.apiBase}/api/widget/owner/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: opts.token, ownerPass: pass }),
      });
      const b = (await res.json().catch(() => null)) as {
        owner?: boolean;
        started?: number;
        total?: number;
        builds?: number;
        note?: string;
      } | null;
      if (b?.owner === false) return opts.onPassRefused();
      if (!res.ok || !b) throw new Error();
      opts.onSay?.(
        builtSay({
          started: b.started ?? 0,
          total: b.total ?? 0,
          ...(typeof b.builds === "number" ? { builds: b.builds } : {}),
          ...(b.note ? { note: b.note.slice(0, 300) } : {}),
        }),
      );
    } catch {
      opts.onSay?.(
        "Your saved notes could not be started just now. They wait in Loki under Feedback.",
      );
    } finally {
      buildBtn.disabled = false;
      start();
    }
  }

  function stop() {
    window.clearInterval(timer);
    timer = 0;
  }

  /** Ask now, then every half minute while something is moving. */
  function start() {
    if (!opts.pass()) return;
    void refresh();
    if (timer) return;
    startedAt = Date.now();
    timer = window.setInterval(() => {
      if (Date.now() - startedAt > CHANGES_POLL_FOR_MS) return stop();
      void refresh();
    }, CHANGES_POLL_MS);
  }

  return {
    refresh,
    start,
    stop,
    count: () => changes.length,
    /** The list itself, for a status line that opens it (thoughts-view.ts). */
    body,
    /** The status line's fragment, and whether something needs the owner. */
    has: () => changes.length > 0 || visitors > 0 || (opts.unsaved?.() ?? 0) > 0,
    headline: () => changesHeadline(changes, waiting()),
    summary: () => changesSummary(changes, visitors, waiting()),
    attention: () => needsYouCount(changes, waiting()) > 0,
    /** Draw the list again (the open card changed: its "not saved" row follows). */
    repaint: () => render(),
    /** The fix a remark's key already has, if any — see known-fixes.ts. */
    known: (key: string) => knownFor(known, key),
    /** Resolves once Loki has answered (or could not), never later than the caller's own wait. */
    ready: () => ready,
  };
}
