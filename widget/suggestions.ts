/**
 * Loki's suggested changes, as ONE decision.
 *
 * Each suggestion used to carry its own "Build this →". Five taps started five
 * agents, each with its own pull request, queued one behind the other in the
 * project's lane — and nothing on the screen said so. "If it proposes five
 * different fixes and I click fix, where is it going? … how do I keep track?"
 * (owner, heidi.orangecat.ch, 2026-10-09).
 *
 * Now the list is a selection — every suggestion ticked to start, a tap
 * unticks — and there is one action: build what is ticked as one change. One
 * agent, one pull request, one row in Your changes. Pure parts are tested in
 * scripts/test/widget-suggestions.ts.
 */
import { h } from "./dom";

/** The ticked suggestions as one request the builder can act on. */
export function combineChanges(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `Make these changes on this page, together:\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
}

/** The action's words for this many ticked, for the owner or a visitor. */
export function buildLabel(count: number, owner: boolean): string {
  if (count === 0) return "Tick what to build";
  if (!owner) return count === 1 ? "Send to builder →" : `Send these ${count} to the builder →`;
  return count === 1 ? "Build this →" : `Build these ${count} as one change →`;
}

export function suggestionBox(opts: {
  items: readonly string[];
  owner: boolean;
  /** Build (owner) or send (visitor) the combined request. */
  onBuild: (text: string) => void;
  /** Owner only: open the request to edit it before it starts. */
  onEdit: (text: string) => void;
}): HTMLElement {
  const box = h("div", "changes");
  box.appendChild(h("div", "changes-title", "Suggested changes"));
  const ticked = opts.items.map(() => true);
  const go = h("button", "change-send");
  go.type = "button";
  const edit = h("button", "act change-edit", "Edit first");
  edit.type = "button";
  const chosen = () => opts.items.filter((_, i) => ticked[i]);
  const sync = () => {
    const n = chosen().length;
    go.textContent = buildLabel(n, opts.owner);
    go.disabled = n === 0;
    edit.style.display = n > 0 ? "" : "none";
  };
  opts.items.forEach((text, i) => {
    const row = h("button", "change on");
    row.type = "button";
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", "true");
    row.append(h("span", "change-tick"), h("span", "change-text", text));
    // A single suggestion needs no ticking — the row is the whole decision.
    if (opts.items.length > 1)
      row.addEventListener("click", () => {
        ticked[i] = !ticked[i];
        row.classList.toggle("on", ticked[i]);
        row.setAttribute("aria-checked", String(ticked[i]));
        sync();
      });
    box.appendChild(row);
  });
  if (opts.items.length === 1) box.classList.add("single");
  go.addEventListener("click", () => {
    const items = chosen();
    if (items.length) opts.onBuild(combineChanges(items));
  });
  edit.addEventListener("click", () => {
    const items = chosen();
    if (items.length) opts.onEdit(combineChanges(items));
  });
  const foot = h("div", "changes-foot");
  // "Edit first" is the owner's: a visitor's send already opens the card.
  if (opts.owner) foot.append(edit);
  foot.append(go);
  box.appendChild(foot);
  sync();
  return box;
}
