/**
 * Talk without opening Loki: a microphone beside the owner's launcher.
 *
 * The owner, 2026-10-18: "should we open the whole widget to start that
 * recording and speaking thing? Or should we do it more elegantly?" Talking
 * while scrolling is what the owner opens Loki for most, and it closes the
 * panel the moment it starts — so opening the panel first was a detour. One
 * tap here starts the recording; Done opens the panel on what was heard.
 *
 * It follows the launcher (the placement engine moves the launcher; this only
 * sits beside it), so it is never placed on its own. Owner only: a visitor's
 * launcher stays quiet, and the edge tab — used when no corner is clear —
 * has no room beside it, so the microphone stays in the panel there.
 */
import { h, micIcon } from "./dom";

const SIZE = 44;
const GAP = 8;

export function createQuickTalk(opts: {
  root: ShadowRoot;
  fab: HTMLElement;
  /** Owner, voice supported, nothing recording and the panel closed. */
  wanted(): boolean;
  onTalk(): void;
}): { sync(): void } {
  const btn = h("button", "fab-talk");
  btn.type = "button";
  btn.append(micIcon());
  btn.setAttribute("aria-label", "Talk to Loki — scroll and say what you'd change");
  btn.title = "Talk to Loki";
  btn.style.display = "none";
  btn.addEventListener("click", () => {
    btn.style.display = "none";
    opts.onTalk();
  });
  opts.root.appendChild(btn);

  function sync() {
    const fab = opts.fab;
    const shown =
      opts.wanted() &&
      fab.isConnected &&
      fab.style.display !== "none" &&
      !fab.classList.contains("tab");
    const r = shown ? fab.getBoundingClientRect() : null;
    if (!r || !r.width) {
      btn.style.display = "none";
      return;
    }
    // On the side of the launcher that faces into the page.
    const left = r.left + r.width / 2 > innerWidth / 2 ? r.left - GAP - SIZE : r.right + GAP;
    const top = r.top + (r.height - SIZE) / 2;
    if (left < 0 || left + SIZE > innerWidth) {
      btn.style.display = "none";
      return;
    }
    btn.style.left = `${Math.round(left)}px`;
    btn.style.top = `${Math.round(top)}px`;
    btn.style.display = "";
  }

  // The launcher moves (avoid pass, shape, owner label): follow it.
  new MutationObserver(sync).observe(opts.fab, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  new ResizeObserver(sync).observe(opts.fab);
  addEventListener("resize", sync);
  sync();
  return { sync };
}
