// /changelog renders Loki's OWN CHANGELOG.md through parseChangelogMarkdown.
// Audited 2026-10-01: the page printed most bullets cut at their first line
// ("Five essays in Thoughts showed"), cut one entry at 700 characters, dropped
// every ### sub-heading, dropped a prose-only entry (so the page jumped a
// month), and kept only the newest 40 entries. This test reads the real file
// and checks the parsed record against the source by a second, independent
// reading of it — so a parser that loses text fails here, whatever the file
// says this week.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelogMarkdown, plainText } from "../../src/lib/register/repo-records";

const SOURCE = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
const entries = parseChangelogMarkdown(SOURCE);
const lines = SOURCE.split(/\r?\n/);

// ---- independent reading of the source: dated headings, sub-headings, whole bullets ----
type SourceEntry = { date: string; subheads: string[]; bullets: string[]; hasProse: boolean };
const source: SourceEntry[] = [];
{
  let cur: SourceEntry | null = null;
  let block: string[] | null = null;
  let nested = false;
  const end = () => {
    if (cur && block) cur.bullets.push(plainText(block.join(" ")));
    block = null;
  };
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      end();
      const date = /(\d{4}-\d{2}-\d{2})/.exec(line);
      cur = date ? { date: date[1], subheads: [], bullets: [], hasProse: false } : null;
      if (cur) source.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^###\s/.test(line)) {
      end();
      cur.subheads.push(plainText(line.replace(/^#+\s*/, "")));
    } else if (/^[-*]\s/.test(line)) {
      end();
      nested = false;
      block = [line.replace(/^[-*]\s+/, "")];
    } else if (/^\s+[-*]\s/.test(line)) {
      nested = true;
    } else if (/^\s+\S/.test(line) && block && !nested) {
      block.push(line.trim());
    } else if (!line.trim()) {
      // A blank line ends the bullet unless an indented paragraph follows; the
      // file does not use those, and the parser test below covers them.
      end();
    } else if (!block) {
      cur.hasProse = true;
    }
  }
  end();
}

// ---- every dated entry appears, in order, none merged or lost ----
{
  assert.ok(source.length > 40, `the file has ${source.length} dated entries`);
  assert.equal(
    entries.length,
    source.length,
    "every dated heading is an entry — no cap on history, no prose-only entry dropped",
  );
  const sortedSource = [...source.map((s) => s.date)].sort().reverse();
  assert.deepEqual(
    entries.map((e) => e.date),
    sortedSource,
  );
  const oldest = sortedSource[sortedSource.length - 1];
  assert.ok(
    entries.some((e) => e.date === oldest),
    `the oldest entry (${oldest}) is on the page`,
  );
}

// ---- every bullet is whole, word for word, and ends where its source ends ----
{
  const rendered = new Set(entries.flatMap((e) => e.done.split("\n")));
  let checked = 0;
  for (const s of source) {
    for (const bullet of s.bullets) {
      checked++;
      assert.ok(
        rendered.has(bullet),
        `${s.date}: bullet rendered whole — expected "${bullet.slice(0, 90)}…" in full`,
      );
    }
  }
  assert.ok(checked > 150, `checked ${checked} bullets`);
  for (const e of entries) {
    for (const line of e.done.split("\n")) {
      assert.ok(!line.endsWith("…"), `${e.date}: no line is truncated with an ellipsis`);
      // Every entry in the file is a sentence. A line that ends on a bare word
      // was cut, or was written as a fragment — either way not for this page.
      assert.match(line, /[.!?)"'”:]$/, `${e.date}: "${line.slice(-60)}" ends mid-sentence`);
    }
  }
}

// ---- sub-headings survive, attached to the right entry ----
{
  for (const s of source) {
    const parsed = entries.filter((e) => e.date === s.date);
    const heads = parsed.flatMap((e) => e.sections.map((x) => x.heading).filter(Boolean));
    for (const h of s.subheads) {
      assert.ok(heads.includes(h), `${s.date}: sub-heading "${h}" survives`);
    }
  }
  assert.ok(
    entries.some((e) => e.sections.some((x) => x.heading === "Fixed")),
    "the file uses ### Fixed somewhere, and it is kept",
  );
}

// ---- prose-only entries are kept as text, not dropped ----
{
  for (const s of source.filter((x) => x.bullets.length === 0)) {
    assert.ok(s.hasProse, `${s.date} has neither bullets nor prose`);
    assert.ok(
      entries.some((e) => e.date === s.date && e.done.length > 0),
      `${s.date}: prose-only entry kept`,
    );
  }
}

// ---- the parser on its own, for shapes the file may grow into ----
{
  const md = [
    "## 2026-01-02 — A title",
    "Intro prose that",
    "wraps over two lines.",
    "",
    "### Added",
    "- **Lead.** First line",
    "  continues here.",
    "  - nested detail",
    "    is dropped.",
    "- Lazy continuation",
    "without indent.",
    "",
    ...Array.from({ length: 45 }, (_, i) => `## 2025-0${(i % 9) + 1}-1${i % 10}\n- Entry ${i}.`),
    "## 2024-12-31",
    `- ${"long sentence ".repeat(80).trim()}.`,
  ].join("\n");
  const parsed = parseChangelogMarkdown(md);
  assert.equal(parsed.length, 47, "no 40-entry cap");
  const first = parsed[0];
  assert.equal(first.title, "A title");
  assert.deepEqual(first.sections, [
    { heading: null, items: [{ lead: null, text: "Intro prose that wraps over two lines." }] },
    {
      heading: "Added",
      items: [
        { lead: "Lead.", text: "First line continues here." },
        { lead: null, text: "Lazy continuation without indent." },
      ],
    },
  ]);
  const long = parsed[parsed.length - 1];
  assert.ok(long.done.length > 1000 && long.done.endsWith("sentence."), "no 700-char cut");
  assert.equal(parseChangelogMarkdown("## 2026-07-03 (c)\n- x.")[0].title, null);
  assert.equal(parseChangelogMarkdown("## [0.8.0] - 2026-08-14\n- x.")[0].title, "0.8.0");
}

console.log(`changelog-own-file: ok (${entries.length} entries)`);
