/**
 * Small, self-contained panel pieces that main.ts only places. Each returns
 * elements and takes callbacks; none holds panel state.
 */
import { h } from "./dom";

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
