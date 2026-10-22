/**
 * The launcher: the FAB, its long-press/right-click escape-hatch menu, and the
 * placement engine that keeps it off other people's chat widgets and off the
 * host page's own controls.
 *
 * ── Where it is, predictably ────────────────────────────────────────────────
 * The launcher is ON SCREEN, in one of two shapes, unless someone switched it
 * off on purpose:
 *
 *   button — the floating button in its corner, moved along the edges by the
 *            avoid pass so it never sits on a control.
 *   tab    — a slim handle flush against the side edge, used when no corner
 *            slot is clear, or when the page region says its corners are busy
 *            (`data-fc-place="tab"`: a terminal, a full-width composer).
 *
 * Off is a decision with an owner and a way back, never a side effect of
 * measuring: the operator pauses the token, the host renders a region with
 * `data-fc-place="hidden"`, or the person hides it for themselves (menu, panel
 * or `Loki.hide()`), undone by `Loki.show()` or `#loki`. It used to vanish for
 * a visitor whenever every corner slot was blocked, and Loki's own pages hid
 * it on the phone's tab bar and on the Terminal — from the outside that read
 * as "sometimes it is there, sometimes not", which is the one thing a way to
 * report problems must never be.
 */
import { h, PENCIL_SVG, spiralMark } from "./dom";
import {
  dragTop,
  readDragPosition,
  snapToEdge,
  SNAP_MARGIN,
  writeDragPosition,
  writeVisitorPlacement,
  type DragPosition,
} from "./visitor-placement";
import {
  chooseSlot,
  chooseTabTop,
  cornerColumn,
  cornerEdges,
  slotOrder,
  withSide,
  type Placement,
  type Slot,
  nearBandTop,
  yieldCorner,
} from "./placement";
import { createHostScanner, readPlaceDirective } from "./host-scan";

/**
 * For the site's OWNER the launcher is the status of Loki on their site, not
 * a quiet feedback button: it says "Watching" (or "Paused") at every width,
 * counts what Loki said while the panel was closed, and shows the newest
 * remark as a bubble beside it. ONE button, and a tap on it opens Loki.
 * Visitors keep the quiet launcher (the "quiet until wanted" rule below was
 * written for strangers on a client's site, not for its owner).
 */
export type OwnerStatus = { watching: boolean; unread: number };

export type Launcher = {
  fab: HTMLButtonElement;
  /** Re-run the avoid pass — the panel calls this after it closes. */
  reposition(): void;
  /** Owner mode (null = a visitor's quiet launcher). */
  setOwnerStatus(status: OwnerStatus | null): void;
  /** Show a remark beside the launcher for a while; tapping it opens Loki. */
  say(text: string): void;
  /** On screen right now, ours or the host's (`data-fc-place="host"`) — the
   *  watch bar only appears when it is not. */
  isShown(): boolean;
  /** The shape it took on the last pass ("tab" = the edge handle). */
  shape(): "button" | "tab";
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
  /** The visitor chose "Hide on this site" — the panel owns what happens next
   *  (store it, remove the launcher, say how to get it back). */
  onHide(): void;
}): Launcher {
  const { root, host, token } = opts;

  // ---- FAB ----
  const fab = h("button", "fab");
  const fabIcon = h("span", "fab-icon");
  fabIcon.innerHTML = PENCIL_SVG;
  const fabLabel = h("span", "fab-label", "Feedback");
  const badge = h("span", "fab-badge");
  badge.style.display = "none";
  fab.append(spiralMark(), fabLabel, fabIcon, badge);
  fab.setAttribute("aria-label", "Give feedback");
  fab.setAttribute("aria-haspopup", "dialog");
  fab.addEventListener("click", (e) => {
    // The click that ends a drag is not a tap: the person moved it, they did
    // not ask to open it.
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    bubble.style.display = "none";
    opts.onOpen();
  });
  root.appendChild(fab);

  // ---- owner status: label, unread count, and the newest remark ----
  const bubble = h("div", "fab-bubble");
  bubble.setAttribute("role", "status");
  bubble.style.display = "none";
  const bubbleText = h("span", "fab-bubble-text");
  const bubbleClose = h("button", "fab-bubble-x", "✕");
  bubbleClose.setAttribute("aria-label", "Dismiss");
  bubble.append(bubbleText, bubbleClose);
  bubble.addEventListener("click", (e) => {
    bubble.style.display = "none";
    if (e.target !== bubbleClose) opts.onOpen();
  });
  root.appendChild(bubble);
  let bubbleTimer = 0;
  const BUBBLE_SHOWN_MS = 12_000;

  /** True while the launcher is drawn as the edge tab (see placeTab). */
  let tab = false;
  /** True while a rendered `data-fc-place="host"` region draws the launcher
   *  for us — see placement.PlaceDirective. */
  let hostDrawn = false;

  /** Owner status remains reachable even on a crowded page: the same button
   *  becomes an edge handle rather than covering the work being read. */
  let owner = false;
  function setOwnerStatus(status: OwnerStatus | null) {
    const wasOwner = owner;
    owner = status !== null;
    fab.classList.toggle("owner", status !== null);
    fab.classList.toggle("watching", !!status?.watching);
    fab.classList.toggle("paused", status !== null && !status.watching);
    // The state in a word, at every width: a turning spiral alone did not
    // read as "Loki is watching" on a phone (owner, 2026-10-17).
    const label = status ? (status.watching ? "Watching" : "Paused") : "Feedback";
    fabLabel.textContent = label;
    const unread = status?.unread ?? 0;
    badge.textContent = unread ? (unread > 9 ? "9+" : String(unread)) : "";
    badge.style.display = unread ? "" : "none";
    fab.setAttribute(
      "aria-label",
      status
        ? `Open Loki${status.watching ? " — watching" : ""}${unread ? `, ${unread} new` : ""}`
        : "Give feedback",
    );
    // Re-measure only when the launcher changes KIND (visitor ↔ owner pill).
    // Watching/Paused flips and unread-count ticks used to re-run the whole
    // avoid pass, and each pass could move it — "it jumps around" (G,
    // 2026-10-22). A label or badge change keeps the spot it already has.
    if (owner !== wasOwner) reposition();
  }

  function say(text: string) {
    if (fab.style.display === "none" || fab.style.visibility === "hidden" || tab) return;
    bubbleText.textContent = text;
    positionBubble();
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => (bubble.style.display = "none"), BUBBLE_SHOWN_MS);
  }

  function positionBubble() {
    // Anchor beside the launcher's own corner so it opens inward.
    const { x, y } = cornerEdges(current.corner);
    bubble.style.left = bubble.style.right = bubble.style.top = bubble.style.bottom = "auto";
    bubble.style[x] = `${current.offsetX}px`;
    bubble.style[y] = `${current.offsetY + 52}px`;
    bubble.style.display = "";
    // Remarks are already in the conversation and unread count. A preview is
    // optional: never lay one over the paragraph or action being read.
    const rect = bubble.getBoundingClientRect();
    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > window.innerWidth ||
      rect.bottom > window.innerHeight ||
      createHostScanner(host).verdict(rect) !== "free"
    ) {
      bubble.style.display = "none";
      return;
    }
  }

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

  // Moving is a drag now (see "drag" below); the old "Move to other corner"
  // item only mirrored the corner and was the only way to move it at all.
  const hideBtn = h("button", "fabmenu-item", "Hide on this site");
  hideBtn.setAttribute("role", "menuitem");
  hideBtn.addEventListener("click", () => {
    hideMenu();
    opts.onHide();
  });

  const resetBtn = h("button", "fabmenu-item", "Reset position");
  resetBtn.setAttribute("role", "menuitem");
  resetBtn.addEventListener("click", () => {
    opts.setVisitorOverride(null);
    writeVisitorPlacement(token, null);
    dragged = null;
    writeDragPosition(token, null);
    hideMenu();
    reposition();
  });

  menu.append(hideBtn, resetBtn);
  root.appendChild(menu);

  function showMenu() {
    // Anchor to the launcher's own corner so the menu opens inward, never
    // off the edge of the viewport.
    const p = current;
    const { x, y } = cornerEdges(p.corner);
    menu.style.left = menu.style.right = menu.style.top = menu.style.bottom = "";
    if (tab) {
      // Beside the tab, opening inward from its edge.
      menu.style[x] = `${fab.offsetWidth + 8}px`;
      menu.style.top = `${Math.max(8, fab.offsetTop)}px`;
    } else {
      menu.style[x] = `${p.offsetX}px`;
      menu.style[y] = `${p.offsetY + 56}px`;
    }
    menu.style.display = "";
    resetBtn.style.display = opts.getVisitorOverride() || dragged ? "" : "none";
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
  // ---- drag: press, move past a small threshold, let go → snap to an edge ----
  //
  // Pointer events cover mouse, pen and touch in one path. Under the
  // threshold it is still a tap (click opens Loki) or a long-press (menu);
  // past it, it is a drag: the long-press is cancelled and the click that
  // follows the drop is swallowed.
  const DRAG_THRESHOLD = 6;
  let dragged: DragPosition | null = readDragPosition(token);
  let suppressClick = false;
  let drag: { id: number; x: number; y: number; dx: number; dy: number; moving: boolean } | null =
    null;
  fab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || tab) return;
    const r = fab.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      moving: false,
    };
    // On the window, not the button: a fast first move leaves the button
    // before the drag has begun.
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
  });
  const onDragMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moving = true;
      cancelPress();
      hideMenu();
      bubble.style.display = "none";
      fab.classList.add("dragging");
    }
    const w = fab.offsetWidth;
    const hgt = fab.offsetHeight;
    const left = Math.min(window.innerWidth - w, Math.max(0, e.clientX - drag.dx));
    const top = Math.min(window.innerHeight - hgt, Math.max(0, e.clientY - drag.dy));
    fab.style.right = fab.style.bottom = "auto";
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
  };
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    const wasMoving = drag.moving;
    drag = null;
    if (!wasMoving) return;
    suppressClick = true;
    // A click may never come (touch drags often end without one).
    window.setTimeout(() => (suppressClick = false), 400);
    const r = fab.getBoundingClientRect();
    dragged = snapToEdge(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    writeDragPosition(token, dragged);
    fab.classList.remove("dragging");
    placeDragged(dragged);
  };

  fab.addEventListener("touchstart", startPress, { passive: true });
  fab.addEventListener("touchend", cancelPress);
  fab.addEventListener("touchmove", cancelPress, { passive: true });
  fab.addEventListener("touchcancel", cancelPress);

  // Scrolling only tucks away a remark preview. The launcher itself stays
  // exactly where it is: re-placing it whenever scrolling settled made it
  // climb, switch sides or turn into the tab mid-read (G, 2026-10-22).
  document.addEventListener(
    "scroll",
    () => {
      bubble.style.display = "none";
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
    setTab(false);
    fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = "auto";
    fab.style[x] = `${slot.offsetX}px`;
    fab.style[y] = `${slot.offsetY}px`;
    fab.classList.toggle("on-left", x === "left");
  };

  /** The person's own spot: snapped to a side edge, at their height. Anchored
   *  by left/top so the snap from where they let go animates. */
  const placeDragged = (pos: DragPosition) => {
    setTab(false);
    const w = fab.offsetWidth;
    const hgt = fab.offsetHeight;
    const top = dragTop(pos, hgt, window.innerHeight);
    const left = pos.side === "left" ? SNAP_MARGIN : window.innerWidth - w - SNAP_MARGIN;
    fab.style.right = fab.style.bottom = "auto";
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
    fab.classList.toggle("on-left", pos.side === "left");
    current = {
      corner: pos.side === "left" ? "bottom-left" : "bottom-right",
      offsetX: SNAP_MARGIN,
      offsetY: Math.max(0, window.innerHeight - top - hgt),
    };
    show(true);
    if (bubble.style.display !== "none") positionBubble();
  };

  function setTab(on: boolean) {
    tab = on;
    fab.classList.toggle("tab", on);
  }
  /** The edge tab on `side`, at the first height that covers no control. */
  const placeTab = (side: "left" | "right", scanner: ReturnType<typeof createHostScanner>) => {
    bubble.style.display = "none";
    setTab(true);
    fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = "auto";
    fab.style[side] = "0px";
    fab.classList.toggle("on-left", side === "left");
    const top = chooseTabTop(window.innerHeight, fab.offsetHeight, (y) => {
      fab.style.top = `${y}px`;
      return scanner.verdict(fab.getBoundingClientRect());
    });
    fab.style.top = `${top}px`;
    show(true);
  };
  const show = (visible: boolean) => {
    fab.style.visibility = visible ? "" : "hidden";
  };

  /** The button and its unread badge, which hangs off its corner. */
  const footprint = () => {
    const rect = fab.getBoundingClientRect();
    const parts = [rect];
    if (badge.style.display !== "none") parts.push(badge.getBoundingClientRect());
    return {
      left: Math.min(...parts.map((r) => r.left)),
      right: Math.max(...parts.map((r) => r.right)),
      top: Math.min(...parts.map((r) => r.top)),
      bottom: Math.max(...parts.map((r) => r.bottom)),
    };
  };

  const reposition = () => {
    if (fab.style.display === "none") return; // panel open — rect is degenerate
    const p = effective();
    const directive = readPlaceDirective();
    // "host": the page draws the launcher itself (Loki's top bar). Nothing of
    // ours goes on screen, but the status is still shown — by the host.
    hostDrawn = directive === "host";
    if (directive === "hidden" || hostDrawn) {
      bubble.style.display = "none";
      show(false);
      return;
    }
    const side = directive === "left" || directive === "right" ? directive : null;
    if (directive === "tab") {
      placeTab(cornerEdges(p.corner).x, createHostScanner(host));
      return;
    }
    // A previous region may have hidden the button; restore visibility before
    // measuring.
    show(true);
    // Where the person dragged it wins over every heuristic and over the
    // host's side/tab hints (only "hidden" above outranks it).
    if (dragged) {
      placeDragged(dragged);
      return;
    }
    // A position the person chose is theirs: heuristics never move it. If it
    // covers something, that was their call.
    const chosen = opts.getVisitorOverride() !== null;
    const base: Slot = {
      corner: side ? withSide(p.corner, side) : p.corner,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    };
    place(base);
    current = base;
    if (!p.autoAvoid || chosen) {
      show(true);
      return;
    }
    const scanner = createHostScanner(host);
    const size = fab.getBoundingClientRect();
    const geometry = { edgeLength: window.innerHeight, size: size.height };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // A side named by the host or chosen by the visitor is kept: the
    // launcher may climb that edge, never jump across the page.
    const locked = side !== null || opts.getVisitorOverride() !== null;
    // A corner holding the host's own floating button is the host's
    // (placement.yieldCorner): the other corner, or the tab, never a tower.
    const start = yieldCorner(
      base.corner,
      (c) => {
        const at = { ...base, corner: c };
        const column = cornerColumn(at, size, nearBandTop(at, geometry), viewport);
        return scanner.floatingControlIn(column, cornerEdges(c).x);
      },
      locked,
    );
    if (start === "tab") return placeTab(cornerEdges(base.corner).x, scanner);
    const from: Slot = { ...base, corner: start.corner };
    const slots = slotOrder(from, { ...geometry, lockSide: locked || start.yielded });
    const nearTop = nearBandTop(from, geometry);
    const pick = chooseSlot(
      slots,
      (slot) => {
        place(slot);
        const rect = footprint();
        if (
          rect.left < 0 ||
          rect.top < 0 ||
          rect.right > window.innerWidth ||
          rect.bottom > window.innerHeight
        ) {
          return "blocked";
        }
        const verdict = scanner.verdict(rect);
        // The owner's wide status pill must not cover prose or a sheet.
        // Visitors retain the quieter launcher's existing placement policy.
        return owner && verdict !== "free" ? "blocked" : verdict;
      },
      nearTop,
    );
    // The owner's status, and a launcher that yielded its corner, belong IN a
    // corner — clear, and near the bottom. Climbing an edge to the middle or
    // the top of the screen (Heidi at 390px, 2026-10-18) read as a different
    // widget on every site; the tab, which says the same state, does not.
    const inCorner =
      pick && (pick.verdict === "free" || pick.verdict === "text") && pick.slot.offsetY <= nearTop;
    if (!pick || ((owner || start.yielded) && !inCorner)) {
      // Keep Loki reachable without forcing the full owner pill onto content.
      placeTab(cornerEdges(base.corner).x, scanner);
      return;
    }
    place(pick.slot);
    current = pick.slot;
    show(true);
    if (bubble.style.display !== "none") positionBubble();
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
    lastDirective = readPlaceDirective();
    window.setTimeout(reposition, 300);
    window.setTimeout(reposition, 1500);
  }, 1000);

  // The avoid pass runs on load, resize and route change ONLY. It used to
  // re-run on every DOM mutation (≤1/s) and every scroll settle, and each run
  // could move the launcher — the "jumping" (G, 2026-10-22). What still
  // reacts to the DOM is the host's explicit contract: a region that says
  // data-fc-place="hidden" / "tab" / "left" / "right" appearing or going away.
  // That is the host's decision, not a measurement, so it is honoured live.
  let lastDirective = readPlaceDirective();
  let directiveTimer = 0;
  new MutationObserver(() => {
    if (directiveTimer) return;
    directiveTimer = window.setTimeout(() => {
      directiveTimer = 0;
      const now = readPlaceDirective();
      if (now === lastDirective) return;
      lastDirective = now;
      reposition();
    }, 200);
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open", "data-fc-avoid", "data-fc-place"],
  });

  return {
    fab,
    reposition,
    setOwnerStatus,
    say,
    // A host-drawn launcher is on screen as far as the owner is concerned:
    // the host shows the same state (Loki.status), so watch mode must not
    // add its own bar on top of it.
    isShown: () =>
      fab.isConnected &&
      fab.style.display !== "none" &&
      (hostDrawn || fab.style.visibility !== "hidden"),
    shape: () => (tab ? "tab" : "button"),
  };
}
