/**
 * Element picking: the full-viewport shield, the hover/selected highlights on
 * HOST-page elements, and the pick bar. Owns the selection; the panel reads it
 * back at submit time.
 */
import { h } from "./dom";

export type SelectedEl = { elementType: string; elementText: string; selector: string };

/**
 * Prefer the thing the visitor meant (link/button/card) over decorative
 * children (img/svg/path/rect). Empty elementText on bare <img> / <rect> made
 * OrangeCat "make this clickable" reports useless for Dispatch fix.
 */
function resolvePickTarget(el: Element): Element {
  const interactive = el.closest(
    'a, button, [role="button"], [role="link"], summary, label, [tabindex]:not([tabindex="-1"])',
  );
  if (interactive instanceof Element) return interactive;

  let cur: Element | null = el;
  while (cur && /^(path|rect|circle|line|polyline|polygon|g)$/i.test(cur.tagName)) {
    cur = cur.parentElement;
  }
  if (cur && cur.tagName.toLowerCase() === "svg") {
    const wrap = cur.parentElement;
    if (wrap && wrap !== document.body) return wrap;
    return cur;
  }
  if (el.tagName.toLowerCase() === "img") {
    const wrap = el.closest("a, button, figure, [role='button'], article, li");
    if (wrap instanceof Element) return wrap;
  }
  return el;
}

function elementLabel(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria.slice(0, 100);
  const alt = el.getAttribute("alt")?.trim();
  if (alt) return alt.slice(0, 100);
  const title = el.getAttribute("title")?.trim();
  if (title) return title.slice(0, 100);
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const tag = el.tagName.toLowerCase();
  if (text) {
    // A container's textContent is every word inside it run together
    // ("coldstart-sep10-2339Started from Loki · …", seen live). Name it
    // by its first heading, or the tag plus its opening words.
    if (el.children.length > 0 && text.length > 60) {
      const heading = el.querySelector("h1,h2,h3,h4,legend,summary,[role=heading]");
      const head = heading?.textContent?.replace(/\s+/g, " ").trim();
      return head
        ? `${tag}: ${head.slice(0, 60)}`
        : `${tag}: \u201c${text.slice(0, 40)}\u2026\u201d`;
    }
    return text.slice(0, 100);
  }
  return `<${tag}>`;
}

/** id / data-testid first; else tag + up to 2 classes (skip fcw-*). */
function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("fcw-"));
  if (cls.length > 0)
    return `${tag}.${cls
      .slice(0, 2)
      .map((c) => CSS.escape(c))
      .join(".")}`;
  return tag;
}

export type Picker = {
  isPicking(): boolean;
  start(): void;
  stop(): void;
  clearSelection(): void;
  /** Select an element without picking — the host already knows which one. */
  preselect(el: Element): void;
  selected(): SelectedEl[];
};

export function createPicker(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  docStyle: HTMLStyleElement;
  backdrop: HTMLElement;
  panel: HTMLElement;
  maxElements: number;
  /** Cancel pressed — the panel resets its own scope before picking stops. */
  onCancel: () => void;
  /** Picking ended — the panel re-syncs its chips and refocuses. */
  onStop: () => void;
}): Picker {
  const { root, host, docStyle, backdrop, panel, maxElements } = opts;
  let picking = false;
  let selected: SelectedEl[] = [];
  let selectedNodes: Element[] = [];
  let hoverNode: Element | null = null;

  // ---- element-pick bar ----
  const pickbar = h("div", "pickbar");
  const pickMsg = h("span", "msg");
  const pickCount = h("span", "count");
  const pickLbl = h("span", "lbl");
  pickMsg.append(h("span", "dot"), pickCount, pickLbl);
  const pickDone = h("button", "go", "Done");
  pickDone.addEventListener("click", stopPicking);
  const pickCancel = h("button", "ghost", "Cancel");
  pickCancel.addEventListener("click", () => {
    clearSelection();
    opts.onCancel();
    stopPicking();
  });
  pickbar.append(pickMsg, pickDone, pickCancel);

  // Full-viewport shield: blocks host navigation/handlers during pick.
  // Target resolution uses elementsFromPoint so we still hit the real DOM
  // under the shield (capture-only listeners on the host page were not
  // enough — some Next Link clicks still navigated mid-pick).
  const pickShield = h("div");
  pickShield.id = "fcw-pick-shield";
  pickShield.setAttribute("aria-hidden", "true");
  Object.assign(pickShield.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147482999",
    cursor: "crosshair",
    background: "transparent",
  } as CSSStyleDeclaration);

  function targetUnderPoint(x: number, y: number): Element | null {
    const stack = document.elementsFromPoint(x, y);
    for (const node of stack) {
      if (node === pickShield || node === host || host.contains(node)) continue;
      if (node instanceof Element) return resolvePickTarget(node);
    }
    return null;
  }

  function onPickMove(e: MouseEvent) {
    const target = targetUnderPoint(e.clientX, e.clientY);
    if (!target) return;
    if (hoverNode && hoverNode !== target) hoverNode.classList.remove("fcw-hover");
    hoverNode = target;
    target.classList.add("fcw-hover");
  }

  function onPickClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = targetUnderPoint(e.clientX, e.clientY);
    if (!target) return;
    toggle(target);
    syncPickbar();
  }

  function toggle(target: Element, only: "add" | "toggle" = "toggle") {
    const selector = generateSelector(target);
    const idx = selected.findIndex((s) => s.selector === selector);
    if (idx > -1) {
      if (only === "add") return;
      selected.splice(idx, 1);
      selectedNodes[idx]?.classList.remove("fcw-selected");
      selectedNodes.splice(idx, 1);
    } else if (selected.length < maxElements) {
      // The highlight lives in docStyle; a preselect happens without a pick
      // session, so make sure the sheet is in the document either way.
      if (!docStyle.isConnected) document.head.appendChild(docStyle);
      selected.push({
        elementType: target.tagName.toLowerCase(),
        elementText: elementLabel(target),
        selector,
      });
      selectedNodes.push(target);
      target.classList.add("fcw-selected");
    }
  }

  function syncPickbar() {
    if (selected.length === 0) {
      pickCount.textContent = "Pick";
      pickLbl.textContent = "Click the element your feedback is about";
      pickDone.disabled = true;
      return;
    }
    const last = selected[selected.length - 1];
    // One label, ellipsised by CSS — the old bar concatenated every
    // selected element's text into a sentence that ran off the pill.
    const label = (last.elementText || last.selector).replace(/\s+/g, " ").slice(0, 60);
    pickCount.textContent = `${selected.length} selected`;
    pickLbl.textContent =
      selected.length === 1 ? `${label} — click more, or Done` : `last: ${label} — Done when ready`;
    pickDone.disabled = false;
  }

  function startPicking() {
    if (picking) return;
    picking = true;
    document.head.appendChild(docStyle);
    backdrop.remove();
    panel.remove();
    // Shield lives in the shadow root under the pickbar so Done/Cancel stay
    // clickable; fixed positioning still covers the host page viewport.
    root.append(pickShield, pickbar);
    syncPickbar();
    pickShield.addEventListener("mousemove", onPickMove, true);
    pickShield.addEventListener("click", onPickClick, true);
    // Also swallow pointerdown so Next <Link> / button handlers never fire.
    pickShield.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    pickShield.removeEventListener("mousemove", onPickMove, true);
    pickShield.removeEventListener("click", onPickClick, true);
    pickShield.remove();
    hoverNode?.classList.remove("fcw-hover");
    hoverNode = null;
    pickbar.remove();
    root.append(backdrop, panel);
    opts.onStop();
  }

  function clearSelection() {
    for (const node of selectedNodes) node.classList.remove("fcw-selected");
    selected = [];
    selectedNodes = [];
    docStyle.remove();
  }

  return {
    isPicking: () => picking,
    start: startPicking,
    stop: stopPicking,
    clearSelection,
    preselect: (el: Element) => toggle(resolvePickTarget(el), "add"),
    selected: () => selected,
  };
}
