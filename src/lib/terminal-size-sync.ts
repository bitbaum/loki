/**
 * Keeping the PTY the same width as the grid the viewer is actually drawing.
 *
 * Measured on /terminal 2026-09-24, desktop 1440×900, Prompt mode: the xterm
 * grid was 79 columns and the cloud session's PTY was still 120. Every row the
 * agent drew at 120 wrapped at 79 — sentences starting halfway through a word,
 * and the right-aligned status line (placed by absolute cursor moves) clamped
 * into the last column as a stack of stray characters down the right edge.
 * On a 390px phone it was 86 vs 120.
 *
 * The cause was not the fit: FitAddon and a ResizeObserver were already there.
 * It was that the resize was only PUBLISHED from an `interactive` view — Type
 * mode with live keystrokes — so Prompt mode, Voice mode, and every phone (live
 * keys are off there by default) fitted the grid locally and never told the
 * PTY. A program cannot re-wrap for a width it has never heard of.
 *
 * So publishing is a property of being attached to a session, not of whether
 * this view also captures keystrokes. The floor in ptyResizeToPublish still
 * decides what a viewer may say (a collapsed host never shrinks the session).
 */
import { ptyResizeToPublish, type PtyGeometry } from "@/lib/terminal-viewport";

export type PtySizeSync = {
  /** Fit the grid to the host, report it, and publish it if it changed. */
  sync: () => PtyGeometry | null;
  /** Publish the current size even if it is what this viewer last sent — for a
   *  viewer coming back to a session another viewer may have resized since. */
  reassert: () => PtyGeometry | null;
};

export function createPtySizeSync({
  fit,
  measure,
  publish,
  onGeometry,
}: {
  /** Fit the grid to its host (FitAddon + any font fitting). May throw when the
   *  host is not laid out yet; a throw is a skipped pass, not an error. */
  fit: () => void;
  /** The grid size after fitting (term.cols / term.rows). */
  measure: () => PtyGeometry;
  /** Send a size to the PTY (transport.sendResize). */
  publish: (cols: number, rows: number) => void;
  onGeometry?: (geometry: PtyGeometry) => void;
}): PtySizeSync {
  let lastPublished: PtyGeometry | null = null;

  const sync = (): PtyGeometry | null => {
    try {
      fit();
    } catch {
      return null;
    }
    const measured = measure();
    onGeometry?.(measured);
    const next = ptyResizeToPublish(measured, lastPublished);
    if (!next) return null;
    lastPublished = next;
    publish(next.cols, next.rows);
    return next;
  };

  return {
    sync,
    reassert: () => {
      lastPublished = null;
      return sync();
    },
  };
}

type ObserverCtor = new (cb: () => void) => {
  observe: (el: Element) => void;
  disconnect: () => void;
};

type EventTargetLike = {
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
};

/**
 * Run `sizes.sync` once now (mount) and again whenever the host box changes —
 * a window resize, the Loki rail collapsing, entering or leaving the expanded
 * view — and `sizes.reassert` when the window regains focus, since another
 * viewer (a phone, a second tab) may have resized the shared session meanwhile.
 * Returns the cleanup.
 */
export function watchTerminalHost(
  host: Element,
  sizes: PtySizeSync,
  {
    ResizeObserverImpl = globalThis.ResizeObserver as unknown as ObserverCtor,
    focusTarget = typeof window === "undefined" ? null : (window as EventTargetLike),
  }: { ResizeObserverImpl?: ObserverCtor; focusTarget?: EventTargetLike | null } = {},
): () => void {
  sizes.sync();
  const observer = new ResizeObserverImpl(() => sizes.sync());
  observer.observe(host);
  const onFocus = () => sizes.reassert();
  focusTarget?.addEventListener("focus", onFocus);
  return () => {
    observer.disconnect();
    focusTarget?.removeEventListener("focus", onFocus);
  };
}
