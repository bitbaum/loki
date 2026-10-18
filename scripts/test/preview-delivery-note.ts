/**
 * A dispatch to a preview folder tells the agent the folder is the site —
 * live on save, no remote, nothing to push (lib/previews/delivery-note).
 *
 * Run: npx tsx scripts/test/preview-delivery-note.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUnderPreviewsRoot, previewDeliveryNote } from "@/lib/previews/delivery-note";

const root = "/home/ubuntu/dev/previews";
assert.equal(isUnderPreviewsRoot(`${root}/tsentr-som`, root), true);
assert.equal(isUnderPreviewsRoot(`${root}/tsentr-som/site`, root), true, "a subfolder counts");
assert.equal(isUnderPreviewsRoot("/home/ubuntu/dev/loki", root), false, "a repository is not one");
assert.equal(
  isUnderPreviewsRoot("/home/ubuntu/dev/previews-old/x", root),
  false,
  "a prefix is not the root",
);
assert.equal(isUnderPreviewsRoot(root, root), false, "the root itself is no project");
assert.equal(isUnderPreviewsRoot(`${root}/x`, null), false, "no previews here: never claimed");
assert.equal(isUnderPreviewsRoot(null, root), false);

const note = previewDeliveryNote({
  projectPath: `${root}/tsentr-som`,
  liveUrl: "https://tsentr-som.orangecat.ch",
  previewsRoot: root,
})!;
assert.match(note, /^## Where this goes/);
assert.match(note, /served straight from disk at https:\/\/tsentr-som\.orangecat\.ch/);
assert.match(note, /do not ask where the remote should live/);
assert.match(note, /Commit your work on the current branch/);
assert.match(note, /There is no delivery step after saving/);
assert.match(
  previewDeliveryNote({ projectPath: `${root}/x`, liveUrl: null, previewsRoot: root })!,
  /at its address/,
  "no address recorded: still the truth about delivery",
);
assert.equal(
  previewDeliveryNote({
    projectPath: "/home/ubuntu/dev/loki",
    liveUrl: "https://loki.orangecat.ch",
    previewsRoot: root,
  }),
  null,
  "a repository keeps the push contract",
);

// The box contract carries the same rule, in the file every box agent reads.
const contract = readFileSync("scripts/hetzner/box-agent-claude.md", "utf8");
assert.match(contract, /## A preview folder is the site/);
assert.match(
  contract,
  /never\s+add an origin, push, create a repository, or ask where the remote should\s+live/,
);

// And the dispatch assembler rides it on every prompt to such a folder.
const assembler = readFileSync("src/lib/inject-prompt.ts", "utf8");
assert.match(
  assembler,
  /previewDeliveryNote\(\{ projectPath, liveUrl, previewsRoot: previewsRoot\(\) \}\)/,
);
assert.match(readFileSync("src/lib/inject-core.ts", "utf8"), /liveUrl: dbMatch\.liveUrl/);

console.log(
  "✓ preview-delivery-note: a preview folder is the site; the agent is told so on every dispatch",
);
