// Render the real /feedback inbox with fixture data. Run:
//   node scripts/preview/build-feedback-preview.mjs [outDir]
// Core: render-harness.mjs.
import { renderPreview } from "./render-harness.mjs";

await renderPreview({
  entry: "feedback-inbox.preview.tsx",
  name: "feedback-preview",
  outDir: process.argv[2],
  queries: ["", "?project=petvity", "?project=5936f8fb-7239-4942-a7a9-95f77e7cc322"],
});
