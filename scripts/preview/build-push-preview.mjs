// Render every state of the "notifications on this phone" card. Run:
//   node scripts/preview/build-push-preview.mjs [outDir]
// Core: render-harness.mjs.
import { renderPreview } from "./render-harness.mjs";

await renderPreview({
  entry: "push-card.preview.tsx",
  name: "push-preview",
  outDir: process.argv[2],
});
