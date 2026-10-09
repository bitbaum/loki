/**
 * "What Loki sees": one line under the panel's header that opens into Loki's
 * running notes while it watches (thoughts.ts words them). Collapsed by
 * default — one row, the spiral turning — so it informs without taking the
 * conversation's room on a phone.
 */
import { h, spiralMark } from "./dom";
import { ago, thoughtsFrom, thoughtsSummary } from "./thoughts";
import type { TrailEntry } from "./watch-trail";

export function createThoughtsView(onToggleWatch: () => void): {
  el: HTMLElement;
  update: (trail: TrailEntry[], watching: boolean) => void;
} {
  const el = h("div", "thoughts");
  // Two controls on one line: the summary opens the notes, the text action
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
  const list = h("ol", "thoughts-list");
  list.style.display = "none";
  el.append(head, list);

  let open = false;
  let last: { trail: TrailEntry[]; watching: boolean } = { trail: [], watching: false };
  row.addEventListener("click", () => {
    open = !open;
    row.setAttribute("aria-expanded", String(open));
    el.classList.toggle("open", open);
    list.style.display = open ? "" : "none";
    paint();
  });

  function paint() {
    const { trail, watching } = last;
    mark.classList.toggle("watching", watching);
    mark.classList.toggle("paused", !watching);
    summary.textContent = thoughtsSummary(trail, watching);
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
  }

  // The "how long ago" column ages while the list is open.
  window.setInterval(() => {
    if (open && el.isConnected) paint();
  }, 15_000);

  return {
    el,
    update(trail, watching) {
      last = { trail, watching };
      paint();
    },
  };
}
