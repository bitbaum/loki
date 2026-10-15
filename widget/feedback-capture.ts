/** A note refers to the page at capture time, not wherever Send happens later. */
import type { SelectedEl } from "./picker";
import { CAPTURE_CONTEXT_LIMITS, type FeedbackCaptureContext } from "./capture-context";

export type FeedbackCapture = {
  url: string;
  page: string;
  title: string;
  selected: SelectedEl[];
  diagnostics: FeedbackCaptureContext;
};
const clean = (value: string | null | undefined, max = 180) =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function captureFeedbackContext(selected: SelectedEl[] = []): FeedbackCapture {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,[role=heading]"))
    .filter(
      (el) =>
        !el.closest("#loki-feedback-host") &&
        el.getClientRects().length &&
        el.getBoundingClientRect().bottom > 0 &&
        el.getBoundingClientRect().top < innerHeight,
    )
    .map((el) => clean(el.innerText || el.textContent, 80))
    .filter(Boolean)
    .slice(0, 4);
  return {
    url: url.href.slice(0, 1000),
    page: url.pathname.slice(0, 300),
    title: clean(document.title, 300),
    selected: selected.map((item) => ({ ...item })),
    diagnostics: {
      "Note captured": new Date().toISOString(),
      "Page when speaking": url.href.slice(0, CAPTURE_CONTEXT_LIMITS.valueChars),
      "Screen when speaking": `${innerWidth}×${innerHeight}; scroll ${Math.round(scrollX)},${Math.round(scrollY)}`,
      "Visible headings": headings.join(" · ").slice(0, CAPTURE_CONTEXT_LIMITS.valueChars),
      ...(selected.length
        ? {
            "Pointed at": selected
              .map((item) => `${item.elementText} (${item.selector})`)
              .join(" · ")
              .slice(0, 300),
          }
        : {}),
    },
  };
}
