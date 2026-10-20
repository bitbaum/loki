/**
 * The panel's one status line, the owner's: "● Watching · 2 changes need
 * you ›  Pause  ✕". For the owner it IS the header (main.ts): the brand row
 * and the page name above it made three rows of chrome before a word of
 * conversation, and on a phone with the keyboard up that left the thread a
 * one-pixel sliver (owner, 2026-10-18). It was two rows — "Watching · 1 page · 2 things to look
 * at" with Pause, and "Your changes · 4 live · 4 from visitors" under it —
 * and with the header and composer that made the panel read like a cockpit
 * (owner, 2026-10-17). One line says the state; opening it shows what Loki
 * noted and where each change is.
 */
import { h, spiralMark } from "./dom";
import { ago, thoughtsFrom, thoughtsSummary, watchHeadline } from "./thoughts";
import type { TrailEntry } from "./watch-trail";

/** What the line carries besides watching — the owner's changes (changes.ts). */
type Extra = {
  /** There is anything to show at all (changes, or visitors' notes). */
  has: () => boolean;
  headline: () => string;
  summary: () => string;
  attention: () => boolean;
  body: HTMLElement;
};

export function createThoughtsView(
  onToggleWatch: () => void,
  extra?: Extra,
): {
  el: HTMLElement;
  /** The line itself — main.ts puts the panel's close button at its end. */
  head: HTMLElement;
  update: (trail: TrailEntry[], watching: boolean) => void;
  /** Repaint with what is known (the changes changed, not the trail). */
  repaint: () => void;
  /** Fold the details away (a row in them pointed somewhere below). */
  close: () => void;
} {
  const el = h("div", "thoughts");
  // Two controls on one line: the summary opens the details, the text action
  // at the end pauses or resumes watching. Status and its control together.
  const head = h("div", "thoughts-head");
  const row = h("button", "thoughts-row");
  row.type = "button";
  row.setAttribute("aria-expanded", "false");
  const mark = spiralMark();
  const summary = h("span", "thoughts-sum");
  const chev = h("span", "thoughts-chev", "›");
  chev.setAttribute("aria-hidden", "true");
  row.append(mark, summary, chev);
  const toggle = h("button", "thoughts-toggle");
  toggle.type = "button";
  toggle.addEventListener("click", onToggleWatch);
  head.append(row, toggle);
  const details = h("div", "thoughts-details");
  details.style.display = "none";
  const list = h("ol", "thoughts-list");
  details.append(list);
  if (extra) {
    const changesHead = h("div", "thoughts-sub");
    extra.body.style.display = "";
    details.append(changesHead, extra.body);
  }
  el.append(head, details);

  let open = false;
  let last: { trail: TrailEntry[]; watching: boolean } = { trail: [], watching: false };
  const setOpen = (value: boolean) => {
    open = value;
    row.setAttribute("aria-expanded", String(open));
    el.classList.toggle("open", open);
    details.style.display = open ? "" : "none";
    paint();
  };
  row.addEventListener("click", () => setOpen(!open));

  function paint() {
    const { trail, watching } = last;
    mark.classList.toggle("watching", watching);
    mark.classList.toggle("paused", !watching);
    el.classList.toggle("watching", watching);
    // One number of one thing: what waits on the owner's decision. Nothing
    // waiting: just the state.
    summary.textContent = watchHeadline(watching, extra?.headline() ?? "");
    row.title = thoughtsSummary(trail, watching);
    el.classList.toggle("needs-you", extra?.attention() ?? false);
    toggle.textContent = watching ? "Pause" : "Resume";
    toggle.title = watching
      ? "Loki stops recording what you do here until you resume"
      : "Loki watches again and tells you when something isn't right";
    if (!open) return;
    list.textContent = "";
    const now = Date.now();
    const lines = thoughtsFrom(trail);
    if (!lines.length) list.appendChild(h("li", "thought", "Nothing yet — use the site as usual."));
    for (const t of lines) {
      const li = h("li", `thought ${t.tone}`);
      li.append(h("span", "thought-at", ago(t.at, now)), h("span", "thought-text", t.text));
      list.appendChild(li);
    }
    const sub = details.querySelector(".thoughts-sub");
    if (sub && extra) {
      const said = extra.has() ? extra.summary() : "";
      sub.textContent = said;
      (sub as HTMLElement).style.display = extra.body.style.display = said ? "" : "none";
    }
  }

  // The "how long ago" column ages while the list is open.
  window.setInterval(() => {
    if (open && el.isConnected) paint();
  }, 15_000);

  return {
    el,
    head,
    update(trail, watching) {
      last = { trail, watching };
      paint();
    },
    repaint: paint,
    close: () => setOpen(false),
  };
}
