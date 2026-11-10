/**
 * The Thoughts ↔ bip-kit seam.
 *
 * Loki's essay parser now lives in the published `bip-kit` package (this
 * repo is its flagship dependent). These tests pin the seam: the re-exports
 * delegate for real, and every committed essay still parses into blocks the
 * renderer has cases for — so a bip-kit upgrade that changed block semantics
 * would fail here, not on the live site.
 */
import { parseContentBlocks } from "@bitbaum/bip-kit";
import { parseThoughtBlocks, listThoughts } from "../../src/lib/thoughts-content";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

// The v0.2 block union rendered by bip-kit/react's ArticleBody (plus the two
// block types ThoughtArticleBody special-cases: image/figure for alt-as-caption
// and inline-SVG, footnote for hoisting). Parser and renderer ship in the SAME
// package version so they cannot drift from each other — what this pin still
// catches is a future bip-kit emitting a block type our WRAPPER mishandles,
// and essays whose chart/stats fences would throw at parse time (they throw
// here, in CI, instead of 500-ing the live route).
const RENDERED_TYPES = new Set([
  "h2",
  "h3",
  "h4",
  "hr",
  "p",
  "ul",
  "ol",
  "blockquote",
  "pullquote",
  "callout",
  "image",
  "figure",
  "gallery",
  "code",
  "mermaid",
  "chart",
  "math",
  "footnote",
  "stats",
  "table",
  "embed",
]);

check("parseThoughtBlocks IS bip-kit's parser, not a fork", () => {
  if (parseThoughtBlocks !== parseContentBlocks) {
    throw new Error("parseThoughtBlocks no longer delegates to bip-kit");
  }
});

check("every committed essay parses into renderer-known block types", () => {
  const thoughts = listThoughts();
  if (thoughts.length === 0) throw new Error("no essays found under content/thoughts");
  for (const thought of thoughts) {
    for (const block of parseThoughtBlocks(thought.body)) {
      if (!RENDERED_TYPES.has(block.type)) {
        throw new Error(`${thought.slug}: block type "${block.type}" has no renderer case`);
      }
    }
  }
});

check("frontmatter quoting still strips through the package", () => {
  const first = listThoughts()[0];
  if (first && (first.title.startsWith('"') || first.title.startsWith("'"))) {
    throw new Error(`title kept its quotes: ${first.title}`);
  }
});

console.log(`\nbip-seam: ${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed > 0) process.exit(1);
