/**
 * "About" — what the next message is about: this page, the whole site, an
 * element you point at, or Loki itself — for a question and for feedback
 * alike. The composer card's top line (theme.ts .seg).
 *
 * "Loki itself" is the fourth: the widget is part of Loki, and saying "this
 * panel is awkward" used to have nowhere to go but the SITE's builder, who
 * did not write it. That note goes to Loki's own project (self-report.ts).
 */
import { h } from "./dom";
import { pressVerb } from "./press";

export type About = "page" | "site" | "element" | "loki";

export function createAboutBar(opts: {
  /** How many elements are picked right now — picking wins over the chips. */
  picked: () => number;
  /** "An element": start (or restart) picking on the page. */
  onPick: () => void;
  /** A chip was tapped: forget any picked elements, redraw the composer. */
  onChange: () => void;
}): {
  el: HTMLElement;
  /** What the next message is about. */
  about: () => About;
  /** The ingest's scope for what is about the SITE (never "loki"). */
  scope: () => "element" | "page" | "site";
  /** Redraw the chips: which is on, how many elements are picked. */
  sync: () => void;
} {
  let chosen: "page" | "site" | "loki" = "page";
  const about = (): About => (opts.picked() ? "element" : chosen);

  const el = h("div", "ctxbar");
  el.appendChild(h("span", "ctx-label", "About"));
  const seg = h("div", "seg");
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "What this is about");
  const pageBtn = h("button", "segbtn", "This page");
  const siteBtn = h("button", "segbtn", "Whole site");
  // Short enough that all four sit on one line of a 320px phone; the titles
  // say the rest.
  // "Point" — it is an action (pick something on the page), not a place.
  const pointBtn = h("button", "segbtn", "Point");
  const lokiBtn = h("button", "segbtn", "Loki");
  pageBtn.title = "About the page you are on";
  siteBtn.title = "About the whole site";
  lokiBtn.title = "About this panel itself — sent to the people who build Loki";
  const chips: [HTMLButtonElement, About][] = [
    [pageBtn, "page"],
    [siteBtn, "site"],
    [pointBtn, "element"],
    [lokiBtn, "loki"],
  ];
  for (const [b] of chips) {
    b.type = "button";
    b.setAttribute("role", "radio");
    seg.appendChild(b);
  }
  const choose = (next: "page" | "site" | "loki") => {
    chosen = next;
    opts.onChange();
  };
  pageBtn.addEventListener("click", () => choose("page"));
  siteBtn.addEventListener("click", () => choose("site"));
  lokiBtn.addEventListener("click", () => choose("loki"));
  // Tapping it again while something is picked picks again (adds/changes).
  pointBtn.addEventListener("click", opts.onPick);
  // One line under the choices saying what Loki does with each — the four
  // words alone left the owner, who built the site, unsure what any of them
  // did (2026-10-16).
  const hintEl = h("div", "ctx-hint");
  hintEl.setAttribute("aria-live", "polite");
  el.append(seg, hintEl);

  const sync = () => {
    const picked = opts.picked();
    const now = about();
    for (const [b, s] of chips) {
      b.classList.toggle("on", now === s);
      b.setAttribute("aria-checked", now === s ? "true" : "false");
    }
    pointBtn.textContent = picked ? `${picked} picked` : "Point";
    hintEl.textContent = aboutHint(now, picked);
    pointBtn.title = picked
      ? `${pressVerb().Verb} to pick again`
      : "Point at something on the page";
  };

  return {
    el,
    about,
    scope: () => {
      const now = about();
      return now === "loki" ? "page" : now;
    },
    sync,
  };
}

/** What Loki does with the choice — one plain line under the control. */
export function aboutHint(about: About, picked: number): string {
  switch (about) {
    case "site":
      return "Loki reads this page and a few others on the site.";
    case "element":
      return `Loki looks at the ${picked === 1 ? "thing" : `${picked} things`} you pointed at. Tap “${picked} picked” to point again.`;
    case "loki":
      return "About this panel itself — it goes to the people who build Loki, not this site's builder.";
    default:
      return `Loki reads the page you are on. ${pressVerb().Verb} Point to show it one thing.`;
  }
}
