/**
 * A compact scope picker for the widget's one conversation. Page is the
 * default; the full-site and Loki-owned targets stay one tap away without
 * making three additional controls compete with the message field.
 */
import { h, TARGET_SVG } from "./dom";
import { pressVerb } from "./press";

export type About = "page" | "site" | "element" | "loki";
type NamedScope = Exclude<About, "element">;

export function createAboutBar(opts: {
  picked: () => number;
  onPick: () => void;
  onChange: () => void;
}): {
  el: HTMLElement;
  about: () => About;
  scope: () => "element" | "page" | "site";
  sync: () => void;
} {
  let chosen: NamedScope = "page";
  const about = (): About => (opts.picked() ? "element" : chosen);
  const el = h("div", "ctxbar");
  const scope = h("div", "scope");
  const scopeBtn = h("button", "scopebtn");
  scopeBtn.type = "button";
  scopeBtn.setAttribute("aria-label", "Message scope: this page");
  scopeBtn.setAttribute("aria-expanded", "false");
  const menu = h("div", "scopemenu");
  menu.setAttribute("role", "radiogroup");
  menu.setAttribute("aria-label", "Message scope");
  menu.hidden = true;

  const scopes: [HTMLButtonElement, NamedScope][] = [
    [h("button", "segbtn", "This page"), "page"],
    [h("button", "segbtn", "Whole site"), "site"],
    [h("button", "segbtn", "Loki itself"), "loki"],
  ];
  for (const [button] of scopes) {
    button.type = "button";
    button.setAttribute("role", "radio");
    menu.appendChild(button);
  }
  scopes[2][0].title = "Something about this panel — sent to the people who build Loki";

  const pointBtn = h("button", "pointbtn");
  pointBtn.type = "button";
  pointBtn.innerHTML = `${TARGET_SVG}<span>Point to area</span>`;
  pointBtn.setAttribute("aria-label", "Point to an area on this page");
  pointBtn.addEventListener("click", () => {
    menu.hidden = true;
    scopeBtn.setAttribute("aria-expanded", "false");
    scopeBtn.focus();
    opts.onPick();
  });
  scopeBtn.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    scopeBtn.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      (scopes.find(([, name]) => name === chosen)?.[0] ?? scopes[0][0]).focus();
    }
  });
  const choose = (next: NamedScope) => {
    chosen = next;
    menu.hidden = true;
    scopeBtn.setAttribute("aria-expanded", "false");
    scopeBtn.focus();
    opts.onChange();
  };
  for (const [button, name] of scopes) button.addEventListener("click", () => choose(name));
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.hidden = true;
      scopeBtn.setAttribute("aria-expanded", "false");
      scopeBtn.focus();
      event.stopPropagation();
      return;
    }
    const index = scopes.findIndex(([button]) => button === event.target);
    if (index < 0) return;
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % scopes.length
        : event.key === "ArrowUp"
          ? (index + scopes.length - 1) % scopes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? scopes.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      scopes[next][0].focus();
    }
  });
  // Close when the user taps anywhere outside the scope control. Listen at
  // the shadow root so taps elsewhere inside Loki's panel are visible too.
  el.ownerDocument.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().includes(el) && !menu.hidden) {
      menu.hidden = true;
      scopeBtn.setAttribute("aria-expanded", "false");
    }
  });
  scope.append(scopeBtn, menu);
  el.append(scope, pointBtn);

  const sync = () => {
    const picked = opts.picked();
    const now = about();
    const label = now === "page" ? "This page" : now === "site" ? "Whole site" : "Loki itself";
    scopeBtn.textContent =
      now === "element" ? `${picked} area${picked === 1 ? "" : "s"}` : `${label}  ▾`;
    scopeBtn.setAttribute("aria-label", `Message scope: ${label.toLowerCase()}`);
    for (const [button, name] of scopes) {
      button.classList.toggle("on", chosen === name);
      button.setAttribute("aria-checked", String(chosen === name));
    }
    pointBtn.querySelector("span")!.textContent = picked ? "Change area" : "Point to area";
    pointBtn.setAttribute("aria-pressed", String(picked > 0));
    pointBtn.setAttribute(
      "aria-label",
      picked ? "Change the area selected on this page" : "Point to an area on this page",
    );
    pointBtn.title = picked
      ? `${pressVerb().Verb} to pick another area`
      : "Point at something on the page";
  };

  return {
    el,
    about,
    scope: () => {
      const now = about();
      return now === "loki" ? "page" : now;
    },
    sync,
  };
}
