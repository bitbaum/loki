import { readFile } from "node:fs/promises";
import path from "node:path";
import { withLivePage } from "@/lib/feedback/page-picture";
import type { PreviewOp } from "../../../widget/preview";
import type { TourOutlineItem } from "../../../widget/tour";

/**
 * The instant preview, minus the model: open the live page, photograph it,
 * hand its outline to `plan`, apply the edits that come back in that browser,
 * and photograph the same spot with and without them.
 *
 * `plan` is injected so the browser half is testable without a model
 * (scripts/test/instant-preview.ts) and the route owns the AI budget.
 */

export type InstantPlan = { summary: string | null; ops: PreviewOp[] };

export type InstantEvent =
  /** The page as it is, at the top — sent the moment it exists. */
  | { type: "now"; image: string }
  /** The same spot without and with the change. */
  | { type: "after"; before: string; after: string; summary: string | null }
  /** No picture with the change: the model had nothing it could draw. */
  | { type: "no-change"; summary: string | null }
  | { type: "no-picture"; reason: string };

/** The bundled page script (widget/instant-page.ts → public/instant-page.js). */
let script: Promise<string | null> | null = null;
function pageScript(): Promise<string | null> {
  script ??= readFile(path.join(process.cwd(), "public", "instant-page.js"), "utf8").catch(
    () => null,
  );
  return script;
}

type InstantApi = {
  outline(): TourOutlineItem[];
  apply(ops: PreviewOp[]): { applied: number; skipped: number; y: number };
  undo(y: number): void;
};
type WithInstant = { __lokiInstant: InstantApi };

/** Pause after an edit so transitions and fonts settle before the picture. */
const SETTLE_MS = 400;

export async function renderInstantPreview(
  url: string,
  plan: (outline: TourOutlineItem[]) => Promise<InstantPlan>,
  emit: (event: InstantEvent) => void,
): Promise<void> {
  const source = await pageScript();
  const result = await withLivePage(url, {}, async ({ page, shoot }) => {
    emit({ type: "now", image: await shoot() });
    if (!source) {
      console.warn("[instant-preview] public/instant-page.js is missing — run build:widget");
      emit({ type: "no-change", summary: null });
      return;
    }
    // evaluate, not a <script> tag: the site's own Content-Security-Policy
    // forbids inline scripts, and this runs in Loki's browser, not theirs.
    await page.evaluate(source);
    const outline = await page.evaluate(() =>
      (window as unknown as WithInstant).__lokiInstant.outline(),
    );
    const planned = await plan(outline);
    if (planned.ops.length === 0) {
      emit({ type: "no-change", summary: planned.summary });
      return;
    }
    const applied = await page.evaluate(
      (ops) => (window as unknown as WithInstant).__lokiInstant.apply(ops),
      planned.ops,
    );
    if (applied.applied === 0) {
      emit({ type: "no-change", summary: planned.summary });
      return;
    }
    await page.waitForTimeout(SETTLE_MS);
    const after = await shoot();
    await page.evaluate((y) => (window as unknown as WithInstant).__lokiInstant.undo(y), applied.y);
    await page.waitForTimeout(SETTLE_MS);
    const before = await shoot();
    emit({ type: "after", before, after, summary: planned.summary });
  });
  if (!result.ok) emit({ type: "no-picture", reason: result.reason });
}
