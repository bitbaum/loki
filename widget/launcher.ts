/**
 * The launcher: the FAB, its long-press/right-click escape-hatch menu, and the
 * placement engine that keeps it off other people's chat widgets and off the
 * host page's own controls.
 */
import { h, PENCIL_SVG } from "./dom";
import { writeVisitorPlacement } from "./visitor-placement";
import {
  avoidOffsetY,
  cornerEdges,
  CORNERS,
  probeCorner,
  stepOffControls,
  type Placement,
} from "./placement";

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
    const p = effective();
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
  window.addEventListener(
    "scroll",
    () => {
      fab.classList.add("scrolling");
      clearTimeout(scrollSettle);
      scrollSettle = window.setTimeout(() => {
        fab.classList.remove("scrolling");
        reposition();
      }, 350);
    },
    { passive: true },
  );

  // ---- placement engine ----
  //
  // One routine for every viewport, replacing a mobile-only version that
  // reset to the base offset above 480px — which is exactly why the launcher
  // kept sitting on top of desktop chat widgets. Two distinct hazards, both
  // real, handled in one pass:
  //
  //   FOREIGN LAUNCHERS (any viewport). Intercom, Crisp, Tawk, Drift and most
  //   in-house AI buttons all default to bottom-right, same as us, and our
  //   near-max z-index means we cover theirs. Measured by rectangle, so it
  //   works against a vendor we have never heard of.
  //
  //   INTERACTIVE CONTROLS (narrow viewports). Content spans the full width,
  //   so whatever scrolls into the corner sits under the launcher and the FAB
  //   steals the tap — measured covering the /auth GitHub sign-in button at
  //   320px. Hit-testing catches this; rectangle-matching alone would not,
  //   because page content is not fixed-position.
  const INTERACTIVE = "a,button,input,select,textarea,summary,[role='button']";

  /** The visitor's choice wins over the operator's, and only for them. */
  const effective = (): Placement => opts.getVisitorOverride() ?? opts.getPlacement();

  const applyPlacement = () => {
    const p = effective();
    const { x, y } = cornerEdges(p.corner);
    // Clear both axes first: switching corners must not leave the old edge
    // set, which would pin the launcher to two opposite sides at once.
    fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = "";
    fab.style[x] = `${p.offsetX}px`;
    fab.style[y] = `${p.offsetY}px`;
  };

  const reposition = () => {
    if (fab.style.display === "none") return; // panel open — rect is degenerate
    const p = effective();
    applyPlacement();
    if (!p.autoAvoid) return;

    const { y } = cornerEdges(p.corner);
    const own = fab.getBoundingClientRect();
    const foreign = probeCorner(host, own);
    const afterForeign = avoidOffsetY(own, foreign, p.corner, p.offsetY);

    // Every width: step over page content the rectangle scan cannot see,
    // because ordinary content is not fixed-position. See stepOffControls.
    const isCovered = (offsetY: number) => {
      fab.style[y] = `${offsetY}px`;
      const r = fab.getBoundingClientRect();
      const pts: Array<[number, number]> = [
        [r.left + 3, r.top + 3],
        [r.right - 3, r.top + 3],
        [r.left + 3, r.bottom - 3],
        [r.right - 3, r.bottom - 3],
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      ];
      return pts.some(([px, py]) =>
        document
          .elementsFromPoint(px, py)
          .some((el) => el !== host && !host.contains(el) && el.closest(INTERACTIVE) !== null),
      );
    };
    fab.style[y] = `${stepOffControls(afterForeign, p.offsetY, isCovered)}px`;
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

  return { fab, reposition };
}
