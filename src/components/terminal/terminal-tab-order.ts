/**
 * How the operator has arranged the terminal's tabs: their order, which are
 * pinned to the front, and whether tabs of one project sit together.
 *
 * Pure, so the rules are pinned without React. Stored per builder in the
 * browser (a layout is a view preference, not session state): the runner owns
 * which sessions exist, this only decides how they are laid out.
 */
export type TabLayout = {
  /** Last arrangement the operator made. Tabs not listed go after, in the order
   *  the runner reports them, so a new session never lands in the middle. */
  order: string[];
  pinned: string[];
  groupByProject: boolean;
};

export const EMPTY_LAYOUT: TabLayout = { order: [], pinned: [], groupByProject: false };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function parseTabLayout(raw: string): TabLayout {
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return EMPTY_LAYOUT;
    const o = p as Record<string, unknown>;
    return {
      order: strings(o.order),
      pinned: strings(o.pinned),
      groupByProject: o.groupByProject === true,
    };
  } catch {
    return EMPTY_LAYOUT;
  }
}

/** The tabs in the order they are shown: saved order, then (optionally)
 *  clustered by project, then pinned first. Each step is stable. */
export function arrangeTabs(
  tabs: readonly string[],
  layout: TabLayout,
  projectOf: (tab: string) => string,
): string[] {
  const live = new Set(tabs);
  const known = layout.order.filter((t) => live.has(t));
  const knownSet = new Set(known);
  let out = [...known, ...tabs.filter((t) => !knownSet.has(t))];
  if (layout.groupByProject) {
    const projects = [...new Set(out.map(projectOf))];
    out = projects.flatMap((p) => out.filter((t) => projectOf(t) === p));
  }
  const pinned = new Set(layout.pinned);
  return [...out.filter((t) => pinned.has(t)), ...out.filter((t) => !pinned.has(t))];
}

/** Drop `id` into the slot `targetId` occupies in what is shown now. Moving
 *  across the pin boundary changes the pin, so a tab never sits where its pin
 *  state says it cannot be. */
export function moveTab(
  layout: TabLayout,
  shown: readonly string[],
  id: string,
  targetId: string,
): TabLayout {
  if (id === targetId || !shown.includes(id) || !shown.includes(targetId)) return layout;
  const without = shown.filter((t) => t !== id);
  const at = without.indexOf(targetId);
  const forward = shown.indexOf(id) < shown.indexOf(targetId);
  const next = [
    ...without.slice(0, forward ? at + 1 : at),
    id,
    ...without.slice(forward ? at + 1 : at),
  ];
  const pinned = new Set(layout.pinned);
  if (pinned.has(targetId)) pinned.add(id);
  else pinned.delete(id);
  return { ...layout, order: next, pinned: [...pinned] };
}

/** One step left or right in what is shown (the keyboard version of a drag). */
export function nudgeTab(
  layout: TabLayout,
  shown: readonly string[],
  id: string,
  by: -1 | 1,
): TabLayout {
  const neighbour = shown[shown.indexOf(id) + by];
  return neighbour ? moveTab(layout, shown, id, neighbour) : layout;
}

export function togglePin(layout: TabLayout, id: string): TabLayout {
  const pinned = layout.pinned.includes(id)
    ? layout.pinned.filter((t) => t !== id)
    : [...layout.pinned, id];
  return { ...layout, pinned };
}

/** A project name worth reading: the 32-hex run suffix some dispatches append
 *  ("xhiva-art-refresh-300d…") hides the part that tells tabs apart. The full
 *  name stays in the tooltip. */
export function readableTabName(name: string): string {
  const short = name.replace(/-[0-9a-f]{32}$/i, "");
  return short || name;
}
