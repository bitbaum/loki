/**
 * Talk without opening Loki: the microphone INSIDE the owner's launcher.
 *
 * The owner, 2026-10-18: "should we open the whole widget to start that
 * recording and speaking thing? Or should we do it more elegantly?" Talking
 * while scrolling is what the owner opens Loki for most, and it closes the
 * panel the moment it starts — so opening the panel first was a detour. One
 * tap here starts the recording; Done opens the panel on what was heard.
 *
 * It is a segment of the launcher, not a second button beside it (owner,
 * 2026-10-23, on a phone: a lone microphone floated over the tab bar, could not
 * be moved, and had no launcher next to it). So:
 *
 *   - the launcher pill widens (`.fab.with-talk`) and the microphone sits in
 *     that room, inside the pill's own rectangle — one outline, one footprint
 *     for the avoid pass, the edge clamp and the drag;
 *   - it is grabbed like the pill (`launcher.grip`): drag, long-press, menu;
 *   - it exists only while the launcher itself is on screen as a button. A
 *     launcher the host draws (Loki's own top bar), the edge tab and the panel
 *     open all mean no microphone, never a microphone alone — it used to
 *     measure a launcher that was `visibility: hidden` and draw beside nothing.
 *
 * Owner only, and only where the browser can record.
 */
import { h, micIcon } from "./dom";
import type { Launcher } from "./launcher";

const SIZE = 44;
/** Room between the microphone and the pill's edge. */
const INSET = 2;
/** The pill moves with a 0.2s transition; follow it so the microphone never
 *  lags behind the launcher it belongs to. */
const FOLLOW_MS = 400;

export function createQuickTalk(opts: {
  root: ShadowRoot;
  fab: HTMLElement;
  launcher: Pick<Launcher, "grip" | "swallowClick" | "reposition">;
  /** Owner, voice supported, nothing recording and the panel closed. */
  wanted(): boolean;
  onTalk(): void;
}): { sync(): void } {
  const { fab, launcher } = opts;
  const btn = h("button", "fab-talk");
  btn.type = "button";
  btn.append(micIcon());
  btn.setAttribute("aria-label", "Talk to Loki — scroll and say what you'd change");
  btn.title = "Talk to Loki";
  btn.style.display = "none";
  btn.addEventListener("click", (e) => {
    if (launcher.swallowClick()) {
      e.preventDefault();
      return;
    }
    btn.style.display = "none";
    opts.onTalk();
  });
  launcher.grip(btn);
  opts.root.appendChild(btn);

  /** The launcher is on screen as a button — ours, visible, not the edge tab. */
  const launcherIsButton = () =>
    fab.isConnected &&
    fab.style.display !== "none" &&
    fab.style.visibility !== "hidden" &&
    !fab.classList.contains("tab");

  function place() {
    const r = fab.getBoundingClientRect();
    if (!r.width) {
      btn.style.display = "none";
      return;
    }
    btn.style.left = `${Math.round(r.right - INSET - SIZE)}px`;
    btn.style.top = `${Math.round(r.top + (r.height - SIZE) / 2)}px`;
    btn.style.display = "";
  }

  function sync() {
    const on = launcherIsButton() && opts.wanted();
    const was = fab.classList.contains("with-talk");
    fab.classList.toggle("with-talk", on);
    // The pill changed width: let the launcher re-anchor it (a pill parked by
    // its left edge would otherwise grow off the right of the screen).
    if (on !== was) launcher.reposition();
    if (!on) {
      btn.style.display = "none";
      return;
    }
    place();
  }

  let followUntil = 0;
  let following = false;
  function follow() {
    followUntil = performance.now() + FOLLOW_MS;
    if (following) return;
    following = true;
    const step = () => {
      if (fab.classList.contains("with-talk")) place();
      if (performance.now() < followUntil) requestAnimationFrame(step);
      else following = false;
    };
    requestAnimationFrame(step);
  }

  // The launcher moves (avoid pass, drag, snap, shape, owner label): follow it.
  new MutationObserver(() => {
    sync();
    follow();
  }).observe(fab, { attributes: true, attributeFilter: ["style", "class"] });
  new ResizeObserver(sync).observe(fab);
  addEventListener("resize", sync);
  sync();
  return { sync };
}
