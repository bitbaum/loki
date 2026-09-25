/**
 * The launcher: the FAB, its long-press/right-click escape-hatch menu, and the
 * placement engine that keeps it off other people's chat widgets and off the
 * host page's own controls.
 */
import { h, PENCIL_SVG } from "./dom";
import { writeVisitorPlacement } from "./visitor-placement";
import {
  chooseSlot,
  cornerEdges,
  CORNERS,
  slotOrder,
  withSide,
  type Placement,
  type Slot,
} from "./placement";
import { createHostScanner, readPlaceDirective } from "./host-scan";

export type Launcher = {
  fab: HTMLButtonElement;
  /** Re-run the avoid pass — the panel calls this after it closes. */
  reposition(): void;
};

export function createLauncher(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  token: string;
  /** The operator's placement, served by boot. */
  getPlacement(): Placement;
  getVisitorOverride(): Placement | null;
  setVisitorOverride(value: Placement | null): void;
  onOpen(): void;
}): Launcher {
  const { root, host, token } = opts;

  // ---- FAB ----
  const fab = h("button", "fab");
  const fabIcon = h("span", "fab-icon");
  fabIcon.innerHTML = PENCIL_SVG;
  fab.append(h("span", "dot"), h("span", "fab-label", "Feedback"), fabIcon);
  fab.setAttribute("aria-label", "Give feedback");
  fab.setAttribute("aria-haspopup", "dialog");
  fab.addEventListener("click", opts.onOpen);
  root.appendChild(fab);

  // ---- visitor escape hatch ----
  //
  // The last line of defence. Auto-avoid handles what it can measure and the
  // operator handles what they noticed; this is for the case both missed, and
  // it belongs to the one person it is actually blocking. Long-press on touch,
  // right-click on a pointer — both the platform-native "more options" gesture,
  // so neither needs a visible affordance cluttering a 48px button.
  const menu = h("div", "fabmenu");
  menu.setAttribute("role", "menu");
  menu.style.display = "none";

  const moveBtn = h("button", "fabmenu-item", "Move to other corner");
  moveBtn.setAttribute("role", "menuitem");
  moveBtn.addEventListener("click", () => {
    const cur = effective();
    // Cycle the corners rather than offering a picker: four taps returns you
    // to where you started, which is its own undo.
    const next = CORNERS[(CORNERS.indexOf(cur.corner) + 1) % CORNERS.length];
    const moved = { ...cur, corner: next, offsetX: 16, offsetY: 16 };
    opts.setVisitorOverride(moved);
    writeVisitorPlacement(token, moved);
    hideMenu();
    reposition();
  });

  const hideBtn = h("button", "fabmenu-item", "Hide on this site");
  hideBtn.setAttribute("role", "menuitem");
  hideBtn.addEventListener("click", () => {
    writeVisitorPlacement(token, { hidden: true });
    hideMenu();
    host.remove();
  });

  const resetBtn = h("button", "fabmenu-item", "Reset position");
  resetBtn.setAttribute("role", "menuitem");
  resetBtn.addEventListener("click", () => {
    opts.setVisitorOverride(null);
    writeVisitorPlacement(token, null);
    hideMenu();
    reposition();
  });

  menu.append(moveBtn, hideBtn, resetBtn);
  root.appendChild(menu);

  function showMenu() {
    // Anchor to the launcher's own corner so the menu opens inward, never
    // off the edge of the viewport.
    const p = current;
    const { x, y } = cornerEdges(p.corner);
    menu.style.left = menu.style.right = menu.style.top = menu.style.bottom = "";
    menu.style[x] = `${p.offsetX}px`;
    menu.style[y] = `${p.offsetY + 56}px`;
    menu.style.display = "";
    resetBtn.style.display = opts.getVisitorOverride() ? "" : "none";
    document.addEventListener("click", onDocClick, true);
  }
  function hideMenu() {
    menu.style.display = "none";
    document.removeEventListener("click", onDocClick, true);
  }
  function onDocClick(e: MouseEvent) {
    if (!host.contains(e.target as Node)) hideMenu();
  }

  fab.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMenu();
  });

  let pressTimer = 0;
  const startPress = () => {
    pressTimer = window.setTimeout(() => {
      pressTimer = 0;
      showMenu();
    }, 500);
  };
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = 0;
    }
  };
  fab.addEventListener("touchstart", startPress, { passive: true });
  fab.addEventListener("touchend", cancelPress);
  fab.addEventListener("touchmove", cancelPress, { passive: true });
  fab.addEventListener("touchcancel", cancelPress);

  // Scroll-fade companion to the narrow-viewport CSS above: the class is
  // toggled on every viewport, but only the ≤480px media query styles it.
  let scrollSettle = 0;
  // Captured on the document, not the window: a bottom sheet or chat log
  // scrolls on its own and never fires a window scroll, yet it moves what sits
  // under the launcher just the same.
  document.addEventListener(
    "scroll",
    () => {
      fab.classList.add("scrolling");
      clearTimeout(scrollSettle);
      scrollSettle = window.setTimeout(() => {
        fab.classList.remove("scrolling");
        reposition();
      }, 350);
    },
    { passive: true, capture: true },
  );

  // ---- placement engine ----
  //
  // One routine for every viewport and every kind of obstacle. Candidate
  // slots come from placement.slotOrder (preferred corner up its near band,
  // the mirrored corner, then the rest of each edge); host-scan measures each
  // one; placement.chooseSlot takes the first that covers nothing, else the
  // first that covers only a host layer, else hides. The history of why it is
  // one pass rather than several special cases is in host-scan.ts.

  /** The visitor's choice wins over the operator's, and only for them. */
  const effective = (): Placement => opts.getVisitorOverride() ?? opts.getPlacement();

  /** Where the launcher actually is now — the menu anchors to this. */
  let current: Slot = { ...effective() };

  const place = (slot: Slot) => {
    const { x, y } = cornerEdges(slot.corner);
    // Every edge to "auto" first, never "": the shadow stylesheet itself sets
    // right/bottom, so clearing the inline value let `right:16px` survive a
    // move to a LEFT corner and the launcher stretched across the whole page
    // ("Move to other corner" did exactly that until the browser test caught
    // it). Only the two anchored edges may hold a length.
    fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = "auto";
    fab.style[x] = `${slot.offsetX}px`;
    fab.style[y] = `${slot.offsetY}px`;
  };
  const show = (visible: boolean) => {
    fab.style.visibility = visible ? "" : "hidden";
  };

  const reposition = () => {
    if (fab.style.display === "none") return; // panel open — rect is degenerate
    const p = effective();
    const directive = readPlaceDirective();
    if (directive === "hidden") {
      show(false);
      return;
    }
    const base: Slot = {
      corner: directive ? withSide(p.corner, directive) : p.corner,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    };
    place(base);
    current = base;
    if (!p.autoAvoid) {
      show(true);
      return;
    }
    const scanner = createHostScanner(host);
    const size = fab.getBoundingClientRect();
    const slots = slotOrder(base, {
      edgeLength: window.innerHeight,
      size: size.height,
      // A side named by the host or chosen by the visitor is kept: the
      // launcher may climb that edge, never jump across the page.
      lockSide: directive !== null || opts.getVisitorOverride() !== null,
    });
    const pick = chooseSlot(slots, (slot) => {
      place(slot);
      return scanner.verdict(fab.getBoundingClientRect());
    });
    if (!pick) {
      // Every slot would sit on a host control. Hidden until the page changes;
      // the next reposition re-measures.
      place(base);
      show(false);
      return;
    }
    place(pick.slot);
    current = pick.slot;
    show(true);
  };

  reposition();
  // Chat widgets and consent bars inject themselves well after first paint,
  // and fonts/hydration shift what sits under the corner. Re-check at two
  // horizons rather than once: 800ms catches layout settle, 2.5s catches a
  // third-party script that boots lazily.
  window.setTimeout(reposition, 800);
  window.setTimeout(reposition, 2500);
  let resizeSettle = 0;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeSettle);
      resizeSettle = window.setTimeout(reposition, 150);
    },
    { passive: true },
  );
  // Client-side routing (Next, React Router) swaps the whole page without a
  // load or a resize, so the corner can gain a send button long after the two
  // horizons above. Polling the URL is the one signal every router emits; a
  // pushState patch would be ours meddling with the host's history.
  let lastHref = location.href;
  window.setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    window.setTimeout(reposition, 300);
    window.setTimeout(reposition, 1500);
  }, 1000);

  // Bottom sheets open, composers mount, cookie bars arrive — none of which
  // resizes or navigates. Watch the host DOM, throttled to one pass a second:
  // an animated page mutates constantly and must not keep us measuring.
  // Mutations inside our own shadow root are invisible to this observer, so
  // repositioning never feeds itself.
  const MUTATION_MIN_INTERVAL = 1000;
  let lastMutationRun = 0;
  let mutationTimer = 0;
  new MutationObserver(() => {
    if (mutationTimer) return;
    const wait = Math.max(200, MUTATION_MIN_INTERVAL - (Date.now() - lastMutationRun));
    mutationTimer = window.setTimeout(() => {
      mutationTimer = 0;
      lastMutationRun = Date.now();
      reposition();
    }, wait);
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open", "data-fc-avoid", "data-fc-place"],
  });

  return { fab, reposition };
}
