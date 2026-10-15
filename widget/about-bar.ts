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
  const pointBtn = h("button", "segbtn", "Element");
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
  el.append(seg);

  const sync = () => {
    const picked = opts.picked();
    const now = about();
    for (const [b, s] of chips) {
      b.classList.toggle("on", now === s);
      b.setAttribute("aria-checked", now === s ? "true" : "false");
    }
    pointBtn.textContent = picked ? `${picked} element${picked > 1 ? "s" : ""}` : "Element";
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
