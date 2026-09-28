/**
 * Small, self-contained pieces of the panel that main.ts only places: the two
 * "sent" views, the scope chips ("about what?"), and the toast shown after a
 * visitor hides the launcher. Each returns elements and takes callbacks; none
 * holds panel state of its own beyond what it renders.
 */
import { h } from "./dom";

export type Scope = "element" | "page" | "site";

/** The owner's note was taken: say what happens now, then let them add another. */
export function ownerSuccessView(
  building: boolean,
  note: string | null,
  onMore: () => void,
): HTMLElement {
  const ok = h("div", "ok");
  ok.append(
    h("div", "tick", building ? "✓" : "!"),
    h("p", undefined, building ? "On it. An agent is building this now." : "Saved."),
    h(
      "div",
      "sub",
      building
        ? "It goes live on this site by itself. Loki tells you when it is."
        : (note ?? "It waits in Loki under Feedback."),
    ),
  );
  const more = h("button", "track", "Say something else");
  more.type = "button";
  more.addEventListener("click", onMore);
  ok.append(more);
  return ok;
}

/** A visitor's report was sent; with a claim link they can follow it. */
export function visitorSuccessView(claimUrl: string | null): HTMLElement {
  const ok = h("div", "ok");
  ok.append(
    h("div", "tick", "✓"),
    h("p", undefined, "Sent. Thank you."),
    h("div", "sub", "Track what happens next in Loki."),
  );
  if (claimUrl) {
    const track = h("a", "track", "Track this feedback →");
    track.href = claimUrl;
    track.target = "_blank";
    track.rel = "noopener noreferrer";
    ok.append(track);
  }
  return ok;
}

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: "element", label: "An element" },
  { key: "page", label: "This page" },
  { key: "site", label: "Whole site" },
];

/**
 * "About what?" — one row of chips shared by Request a change and Ask Loki,
 * plus the hint line under it (how many elements are picked).
 */
export function createScopeChips(onPick: (scope: Scope) => void) {
  const chips = h("div", "chips");
  const hint = h("div", "hint");
  const els = new Map<Scope, HTMLButtonElement>();
  for (const def of SCOPES) {
    const chip = h("button", "chip", def.label);
    chip.addEventListener("click", () => onPick(def.key));
    els.set(def.key, chip);
    chips.appendChild(chip);
  }
  return {
    chips,
    hint,
    sync(scope: Scope, selectedCount: number) {
      for (const [key, chip] of els) chip.classList.toggle("on", key === scope);
      hint.textContent =
        scope === "element"
          ? selectedCount
            ? `${selectedCount} element${selectedCount > 1 ? "s" : ""} selected`
            : "Pick the element the feedback is about"
          : "";
      hint.style.display = hint.textContent ? "block" : "none";
    },
  };
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

/**
 * The mode tabs (Request a change / Ask Loki / Chat …) and the hint line under
 * them. Owns only the tabs' own look; what a mode SHOWS stays with the panel,
 * which passes `onSelect` and re-renders from it.
 */
export function createModeTabs<M extends string>(
  modes: M[],
  meta: Record<M, { label: string; hint: string; shipped: boolean }>,
  onSelect: (mode: M) => void,
) {
  const row = h("div", "modes");
  row.setAttribute("role", "tablist");
  row.setAttribute("aria-label", "Loki modes");
  const hint = h("div", "mode-hint");
  const btns = new Map<M, HTMLButtonElement>();
  for (const m of modes) {
    const btn = h("button", "mode", meta[m].label);
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => {
      if (meta[m].shipped) onSelect(m);
    });
    btns.set(m, btn);
    row.appendChild(btn);
  }
  return {
    row,
    hint,
    sync(current: M, hintText: string) {
      for (const [m, btn] of btns) {
        btn.classList.toggle("on", m === current);
        btn.setAttribute("aria-selected", m === current ? "true" : "false");
        btn.disabled = !meta[m].shipped;
        btn.title = meta[m].hint;
      }
      hint.textContent = hintText;
    },
  };
}
