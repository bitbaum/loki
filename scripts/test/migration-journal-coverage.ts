/**
 * Every migration FILE is in the journal, and every journal tag has a FILE.
 * Run: npx tsx scripts/test/migration-journal-coverage.ts
 *
 * The class this closes: `drizzle/meta/_journal.json` is the only thing
 * `drizzle-kit generate` reads to know what already exists. The box applier
 * (`scripts/hetzner/apply-schema.sh`) does NOT read it — it globs the
 * directory and keeps its own `public._deploy_schema_history`. So a migration
 * can be written, applied to production, and serve traffic for months while
 * the journal never learns about it. Nothing fails, nothing warns.
 *
 * It surfaces on the NEXT `pnpm db:generate`, which re-emits every migration
 * the journal is missing. The re-emitted `CREATE TABLE` carries no
 * IF NOT EXISTS (drizzle-kit never emits it), apply-schema.sh only rewrites
 * ADD COLUMN, and the batch is one transaction — so the deploy aborts with
 * `relation "..." already exists` on a change that had nothing to do with it.
 *
 * Measured on 2026-09-20: 78 files, 65 journal entries, 13 missing — drifted
 * across ~5 weeks of migrations with prod perfectly healthy the whole time.
 *
 * The reverse direction matters too: a journal tag with no file means the
 * snapshot chain references a migration that is gone, and generate will
 * produce a diff against a history that cannot be replayed.
 *
 * Fix when this fails:
 *   npx tsx scripts/db/bootstrap-migration-ledger.ts --write-journal
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const MIG_DIR = "drizzle";
const JOURNAL = "drizzle/meta/_journal.json";

type JournalEntry = { idx: number; tag: string };

const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as { entries: JournalEntry[] };

const fileTags = readdirSync(MIG_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .map((f) => f.slice(0, -4))
  .sort();

const journalTags = journal.entries.map((e) => e.tag).sort();

const missingFromJournal = fileTags.filter((t) => !journalTags.includes(t));
const orphanJournalTags = journalTags.filter((t) => !fileTags.includes(t));

assert.deepEqual(
  missingFromJournal,
  [],
  `${missingFromJournal.length} migration file(s) are not in ${JOURNAL}:\n` +
    missingFromJournal.map((t) => `  ${t}.sql`).join("\n") +
    `\n\nThe next \`pnpm db:generate\` will re-emit these and the deploy will abort.\n` +
    `Fix: npx tsx scripts/db/bootstrap-migration-ledger.ts --write-journal`,
);

assert.deepEqual(
  orphanJournalTags,
  [],
  `${orphanJournalTags.length} journal tag(s) have no .sql file:\n` +
    orphanJournalTags.map((t) => `  ${t}`).join("\n") +
    `\n\nThe migration history cannot be replayed. Restore the file or rebuild` +
    ` the journal.`,
);

// idx must be contiguous from 0 or 1 — a gap means an entry was hand-deleted,
// which silently shifts what drizzle-kit believes the latest snapshot covers.
const idxs = journal.entries.map((e) => e.idx).sort((a, b) => a - b);
for (let i = 1; i < idxs.length; i++) {
  assert.equal(
    idxs[i],
    idxs[i - 1]! + 1,
    `journal idx is not contiguous: ${idxs[i - 1]} → ${idxs[i]}. An entry was` +
      ` removed by hand; rebuild with --write-journal.`,
  );
}

console.log(
  `✓ migration journal: ${fileTags.length} files, ${journalTags.length} journal entries, idx contiguous`,
);
