// A bare address in a roadmap line renders as a link (RoadmapJourney withLinks).
// Run: npx tsx scripts/test/roadmap-line-links.ts
import assert from "node:assert/strict";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withLinks } from "@/components/public/RoadmapJourney";

const html = (text: string) =>
  renderToStaticMarkup(withLinks(text) as unknown as ReactElement) as string;

// An address on Loki itself links by its path, and the sentence keeps its full stop.
assert.equal(
  html("Essay: https://loki.orangecat.ch/thoughts/where-stakeholders-live."),
  'Essay: <a href="/thoughts/where-stakeholders-live" class="ui-public-link">/thoughts/where-stakeholders-live</a>.',
);

// Another site keeps its full address as the target and drops the scheme from the label.
assert.equal(
  html("See https://example.org/a/b today"),
  'See <a href="https://example.org/a/b" class="ui-public-link">example.org/a/b</a> today',
);

// No address: the text is untouched.
const plain = withLinks("Nothing to link here");
assert.ok(Array.isArray(plain) && plain.length === 1 && isValidElement(plain[0]));
assert.equal(html("Nothing to link here"), "Nothing to link here");

console.log("✓ roadmap lines link their addresses");
