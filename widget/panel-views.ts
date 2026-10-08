/**
 * Small, self-contained pieces of the panel that main.ts only places: the
 * Watch offer under the header, and the toast shown after a visitor hides the
 * launcher. Each returns elements and takes callbacks; none holds panel state.
 */
import { h } from "./dom";

/**
 * What "Watch" in the header opens for anyone Loki does not yet know as the
 * site's owner: what Watch does, that only the owner can switch it on, and
 * the one link that does it (a round trip through Loki's sign-in that lands
 * back on this page with Watch on — src/app/api/widget/owner/route.ts).
 * Hidden until asked for.
 */
export function watchOfferView(signInUrl: string): HTMLElement {
  const box = h("div", "watch-offer");
  box.style.display = "none";
  box.append(
    h("b", undefined, "Let Loki watch you use this site"),
    h(
      "p",
      undefined,
      "Loki follows what you tap and what the page does, fixes what breaks, and on Review tells you what to improve — design, speed, errors, the flow itself. A bar at the top shows it is on, and nothing you type is ever recorded.",
    ),
    h("p", "sub", "Only the site's owner can switch it on."),
  );
  const go = h("a", "track", "This is my site — sign in with Loki →");
  go.href = signInUrl;
  go.rel = "noopener";
  box.append(go);
  return box;
}

/** Shown after a visitor hides the launcher: how to undo it, now and later. */
export function showHideToast(root: ShadowRoot, onUndo: () => void): HTMLElement {
  const toast = h("div", "toast");
  toast.setAttribute("role", "status");
  const undo = h("button", "toast-undo", "Undo");
  undo.addEventListener("click", onUndo);
  toast.append(
    h("span", undefined, "Loki is hidden on this site. Add #loki to the address to bring it back."),
    undo,
  );
  root.appendChild(toast);
  window.setTimeout(() => toast.remove(), 10_000);
  return toast;
}
