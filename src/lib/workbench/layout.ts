import {
  WORKBENCH_PANE_IDS,
  type WorkbenchPaneId,
  type WorkbenchPlacement,
} from "@/config/workbench";

/**
 * Which panes THIS window shows. Device-local on purpose: two screens are one
 * machine, and a laptop and a phone want different arrangements of the same
 * project — so this is a localStorage preference per project, never a column
 * on the project. Pure; tested in scripts/test/workbench-layout.ts.
 */
export type WorkbenchLayout = { open: WorkbenchPaneId[] };

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = { open: [...WORKBENCH_PANE_IDS] };

export function workbenchLayoutKey(projectId: string): string {
  return `loki:workbench:${projectId}`;
}

export function isWorkbenchPaneId(value: unknown): value is WorkbenchPaneId {
  return typeof value === "string" && (WORKBENCH_PANE_IDS as readonly string[]).includes(value);
}

/** The pane a `?pane=` names, or null for the whole workbench. */
export function paneFromParam(value: string | null | undefined): WorkbenchPaneId | null {
  return isWorkbenchPaneId(value) ? value : null;
}

/** Panes in the registry's order, each at most once, unknown ids dropped. */
function normalize(ids: readonly unknown[]): WorkbenchPaneId[] {
  return WORKBENCH_PANE_IDS.filter((id) => ids.includes(id));
}

export function serializeLayout(layout: WorkbenchLayout): string {
  return JSON.stringify({ open: normalize(layout.open) });
}

/** A stored layout, or the default when it cannot be read. An empty `open`
 *  is kept: a person who closed every pane in this window meant it. */
export function parseLayout(raw: string): WorkbenchLayout {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_WORKBENCH_LAYOUT;
    const open = (parsed as { open?: unknown }).open;
    if (!Array.isArray(open)) return DEFAULT_WORKBENCH_LAYOUT;
    return { open: normalize(open) };
  } catch {
    return DEFAULT_WORKBENCH_LAYOUT;
  }
}

export function setPaneOpen(
  layout: WorkbenchLayout,
  pane: WorkbenchPaneId,
  open: boolean,
): WorkbenchLayout {
  const without = layout.open.filter((id) => id !== pane);
  return { open: normalize(open ? [...without, pane] : without) };
}

export function isPaneOpen(layout: WorkbenchLayout, pane: WorkbenchPaneId): boolean {
  return layout.open.includes(pane);
}

/** Where new windows go, remembered on this device (the same choice drives
 *  the site and every popped-out pane: one decision, one place). */
export const WORKBENCH_PLACEMENT_KEY = "loki:workbench:placement";

export function parsePlacement(raw: string): WorkbenchPlacement {
  return raw === "other-screen" ? "other-screen" : "beside";
}

/**
 * Which open panes are on screen. With room for columns, all of them; with
 * room for one, the focused pane if it is open, else the first open one.
 * Focus is session state in the window (a tiled window shows one pane and
 * the strip picks which); the layout is what is remembered.
 */
export function panesOnScreen(
  layout: WorkbenchLayout,
  columns: boolean,
  focus: WorkbenchPaneId | null,
): WorkbenchPaneId[] {
  if (columns || layout.open.length === 0) return layout.open;
  return [focus && layout.open.includes(focus) ? focus : layout.open[0]];
}
