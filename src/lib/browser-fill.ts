/**
 * The form filler Fleet Runner runs inside a page (config/browser-tasks.ts).
 *
 * It is ONE self-contained function on purpose: the runner sends it to the
 * page as source (`fn.toString()`), so it may not touch anything outside its
 * own body — no imports, no module helpers. scripts/test/browser-fill.ts runs
 * that exact source in Chromium against forms built the way npm's is
 * (React-controlled inputs, labels that are not <label for>).
 *
 * Fields are found by their VISIBLE label, not by selectors: the person
 * checking the result reads the same words, and a selector breaks on the next
 * deploy of a site we do not own while a label rarely does.
 *
 * It is idempotent — the runner calls it every few hundred ms until the form
 * is ready — and it never presses the hand-off button.
 */
import type { BrowserTask } from "@/config/browser-tasks";

export type BrowserFillResult =
  /** Not on the task's host (a sign-in page): nothing touched. */
  | { state: "elsewhere"; host: string }
  /** On the host but a field is not there yet (still loading, signed out). */
  | { state: "waiting"; missing: string[] }
  /** Every step applied and the hand-off button outlined. */
  | { state: "ready" };

export function fillBrowserForm(task: BrowserTask): BrowserFillResult {
  const BANNER_ID = "loki-handoff-banner";
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .replace(/\s+/g, " ")
      .replace(/\*+\s*$/, "")
      .trim()
      .toLowerCase();

  const banner = (text: string, tone: "wait" | "ready") => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BANNER_ID;
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:12px 16px;" +
        "border-radius:10px;font:600 15px/1.4 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.25)";
      document.body.appendChild(el);
    }
    el.style.background = tone === "ready" ? "#111" : "#333";
    el.style.color = "#fff";
    el.textContent = text;
  };

  if (location.host !== task.host) return { state: "elsewhere", host: location.host };

  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    return !!r && (r.width > 0 || r.height > 0);
  };
  const isControl = (
    el: Element | null,
  ): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    !!el &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) &&
    (el as HTMLInputElement).type !== "hidden";

  /** The control a visible label names: <label for>, a wrapping label,
   *  aria-label / aria-labelledby, or the first control after the label text. */
  const controlFor = (
    label: string,
  ): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null => {
    const want = norm(label);
    for (const el of Array.from(document.querySelectorAll("input,textarea,select"))) {
      if (!isControl(el) || !visible(el)) continue;
      if (norm(el.getAttribute("aria-label")) === want) return el;
      const by = el.getAttribute("aria-labelledby");
      if (
        by &&
        norm(
          by
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent)
            .join(" "),
        ) === want
      )
        return el;
    }
    const candidates = Array.from(
      document.querySelectorAll("label,legend,span,p,div,h1,h2,h3,h4,h5,h6,dt"),
    );
    for (const el of candidates) {
      // The element's OWN words: a wrapper div whose text is the whole form
      // must not match the first field's label.
      if (norm(el.textContent) !== want || !visible(el)) continue;
      if (el instanceof HTMLLabelElement && isControl(el.control)) return el.control;
      const nested = el.querySelector("input,textarea,select");
      if (isControl(nested)) return nested;
      // First control after the label in document order, before any other
      // label claims it (help text between them is fine).
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      walker.currentNode = el;
      let node = walker.nextNode() as Element | null;
      while (node) {
        if (isControl(node) && visible(node)) return node;
        if (node.tagName === "LABEL" && !el.contains(node)) break;
        node = walker.nextNode() as Element | null;
      }
    }
    return null;
  };

  const buttonFor = (text: string): HTMLElement | null => {
    const want = norm(text);
    for (const el of Array.from(
      document.querySelectorAll(
        "button,[role=button],[role=tab],[role=option],[role=radio],a,input[type=submit]",
      ),
    )) {
      const words = el instanceof HTMLInputElement ? el.value : el.textContent;
      if (norm(words) === want && visible(el)) return el as HTMLElement;
    }
    return null;
  };

  /** React keeps its own copy of an input's value; setting `.value` alone is
   *  undone on the next render. The prototype setter plus an input event is
   *  what a keystroke does. */
  const setValue = (
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string,
  ) => {
    if (el.value === value) return;
    const proto = Object.getPrototypeOf(el) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const missing: string[] = [];
  for (const step of task.steps) {
    if (step.kind === "click") {
      if (controlFor(step.unless)) continue;
      const button = buttonFor(step.text);
      if (button) button.click();
      else missing.push(step.text);
      continue;
    }
    const control = controlFor(step.label);
    if (!control) {
      missing.push(step.label);
      continue;
    }
    if (step.kind === "fill") setValue(control, step.value);
    else if (control instanceof HTMLInputElement && control.checked !== step.checked)
      control.click();
  }

  const handoff = buttonFor(task.handoff.button);
  if (missing.length > 0 || !handoff) {
    if (!handoff) missing.push(task.handoff.button);
    banner(
      "Loki is filling this form. If the site asks you to sign in, sign in — Loki carries on.",
      "wait",
    );
    return { state: "waiting", missing };
  }
  handoff.style.outline = "3px solid #ff5c00";
  handoff.style.outlineOffset = "3px";
  handoff.scrollIntoView({ block: "center" });
  banner(task.handoff.say, "ready");
  return { state: "ready" };
}

/**
 * The exact source the runner evaluates in the page. This relies on the
 * function surviving as source: Fleet Runner's main bundle is not minified and
 * carries no name helpers, and scripts/test/browser-fill.ts runs the function
 * as extracted from that build, so a build change that breaks it fails a test
 * instead of a hand-off.
 */
export function browserFillScript(task: BrowserTask): string {
  return `(${fillBrowserForm.toString()})(${JSON.stringify(task)})`;
}
