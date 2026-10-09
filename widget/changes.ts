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
}) {
  const el = h("div", "yours");
  el.style.display = "none";
  const head = h("div", "yours-head");
  const title = h("span", "changes-title", "Your changes");
  const all = h("a", "yours-all");
  all.target = "_blank";
  all.rel = "noopener";
  head.append(title, all);
  const list = h("div", "yours-list");
  el.append(head, list);

  let changes: OwnerChange[] = [];
  let inbox: string | null = null;
  let timer = 0;
  let startedAt = 0;
  let inflight = false;

  function render() {
    list.textContent = "";
    el.style.display = changes.length ? "" : "none";
    for (const c of changes.slice(0, CHANGES_SHOWN)) {
      const row = h("div", `yours-row tone-${c.tone}`);
      const dot = h("span", "yours-dot");
      const text = h("span", "yours-text", c.text);
      text.title = c.text;
      const status = h("span", "yours-status", c.label);
      status.title = c.detail;
      row.append(dot, text, status);
      if (c.href && c.action) {
        const go = h("a", "yours-go", `${c.action} →`);
        go.href = c.href;
        go.rel = "noopener";
        row.append(go);
      }
      list.appendChild(row);
    }
    const more = changes.length - CHANGES_SHOWN;
    all.textContent = more > 0 ? `All ${changes.length} in Loki →` : "In Loki →";
    all.style.display = inbox ? "" : "none";
    if (inbox) all.href = inbox;
  }

  async function refresh(): Promise<void> {
    const pass = opts.pass();
    if (!pass || inflight) return;
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
      } | null;
      if (!res.ok || !body) return;
      if (body.owner === false) {
        opts.onPassRefused();
        return;
      }
      const next = parseChanges(body);
      inbox = typeof body.inbox === "string" && /^https?:\/\//.test(body.inbox) ? body.inbox : null;
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

  return { el, refresh, start, stop, count: () => changes.length };
}
