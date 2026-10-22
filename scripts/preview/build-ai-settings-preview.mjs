// Render Settings → AI (every card, mocked routes) with a key, with none, and
// on a paid plan. Run:
//   node scripts/preview/build-ai-settings-preview.mjs [outDir]
// Core: render-harness.mjs.
import { renderPreview } from "./render-harness.mjs";

await renderPreview({
  entry: "ai-settings.preview.tsx",
  name: "ai-settings-preview",
  queries: ["", "?empty=1", "?plan=1"],
  outDir: process.argv[2],
});
