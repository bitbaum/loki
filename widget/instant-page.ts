/**
 * The page half of the instant preview on /change (src/lib/instant-preview):
 * Loki opens a stranger's live site in ITS OWN browser on the server, reads
 * the outline the widget's tour reads, and applies "Show me" edits. It is the
 * same code as the widget — the same closed vocabulary, the same sanitising —
 * bundled to public/instant-page.js and evaluated in that one headless page.
 * Nothing here is ever served into the visitor's site.
 */
import { applyPreview, type PreviewOp } from "./preview";
import { buildTourOutline } from "./tour";

/** Room left above the first change, so the picture shows what leads into it. */
const ABOVE_CHANGE_PX = 96;

let els: Element[] = [];
let undo: (() => void) | null = null;

(window as unknown as { __lokiInstant: unknown }).__lokiInstant = {
  outline() {
    const built = buildTourOutline();
    els = built.els;
    return built.items;
  },
  apply(ops: PreviewOp[]) {
    const result = applyPreview(ops, els);
    undo = result.undo;
    const first = result.first as HTMLElement | null;
    if (first) {
      const top = first.getBoundingClientRect().top + window.scrollY - ABOVE_CHANGE_PX;
      window.scrollTo(0, Math.max(0, top));
    }
    return { applied: result.applied, skipped: result.skipped, y: window.scrollY };
  },
  undo(y: number) {
    undo?.();
    undo = null;
    window.scrollTo(0, y);
  },
};
