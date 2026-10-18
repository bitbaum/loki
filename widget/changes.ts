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
export function changesSummary(changes: readonly OwnerChange[], visitors = 0): string {
  const count = (label: string) => changes.filter((c) => c.label === label).length;
  const parts = [
    ["needs you", count("Needs you")],
    ["saved", savedNotes(changes)],
    ["building", count("Building") + count("Starting")],
    ["in line", count("In line")],
    ["on its way", count("On its way")],
    ["live", changes.filter((c) => c.live).length],
  ]
    .filter(([, n]) => (n as number) > 0)
    .map(([w, n]) => `${n} ${w}`);
  if (visitors) parts.push(`${visitors} from visitors`);
  return parts.length ? `Your changes · ${parts.join(" · ")}` : `Your changes · ${changes.length}`;
}

/**
 * The one fragment the panel's status line carries about changes: the most
 * urgent thing, not every count — "1 needs you", else "2 building", … else
 * "4 live". Empty when there is nothing to say. The full line is
 * changesSummary, shown when the list is open.
 */
export function changesHeadline(changes: readonly OwnerChange[]): string {
  const count = (...labels: string[]) => changes.filter((c) => labels.includes(c.label)).length;
  const saved = savedNotes(changes);
  const ranked: Array<[number, string]> = [
    [count("Needs you"), "needs you"],
    [saved, saved === 1 ? "note saved" : "notes saved"],
    [count("Building", "Starting"), "building"],
    [count("In line"), "in line"],
    [count("On its way"), "on its way"],
    [changes.filter((c) => c.live).length, "live"],
  ];
  const top = ranked.find(([n]) => n > 0);
  return top ? `${top[0]} ${top[1]}` : "";
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
export function builtSay(r: { started: number; total: number; note?: string }): string {
  if (!r.total) return "There are no saved notes waiting.";
  if (r.started === r.total)
    return r.total === 1
      ? "Started your saved note — Loki builds it and tells you when it is live."
      : `Started your ${r.total} saved notes — Loki builds them one after another and tells you as each goes live.`;
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
    }))
    .slice(0, CHANGES_MAX);
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
    for (const c of changes.slice(0, CHANGES_SHOWN)) {
      // The row IS the link when there is somewhere to go — no second line.
      const row = c.href
        ? h("a", `yours-row tone-${c.tone}`)
        : h("div", `yours-row tone-${c.tone}`);
      if (row instanceof HTMLAnchorElement && c.href) {
        row.href = c.href;
        row.rel = "noopener";
        row.target = "_blank";
      }
      row.title = c.detail;
      const text = h("span", "yours-text", c.text);
      const status = h("span", "yours-status", c.label);
      row.append(h("span", "yours-dot"), text, status);
      list.appendChild(row);
    }
    const more = changes.length - CHANGES_SHOWN;
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
        note?: string;
      } | null;
      if (b?.owner === false) return opts.onPassRefused();
      if (!res.ok || !b) throw new Error();
      opts.onSay?.(
        builtSay({
          started: b.started ?? 0,
          total: b.total ?? 0,
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
    has: () => changes.length > 0 || visitors > 0,
    headline: () => changesHeadline(changes),
    summary: () => changesSummary(changes, visitors),
    attention: () => changes.some((c) => c.tone === "warning"),
    /** The fix a remark's key already has, if any — see known-fixes.ts. */
    known: (key: string) => knownFor(known, key),
    /** Resolves once Loki has answered (or could not), never later than the caller's own wait. */
    ready: () => ready,
  };
}
