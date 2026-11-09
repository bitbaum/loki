/**
 * The knowledge reindex embeds only chunks that are new or changed.
 * Run: npx tsx scripts/test/reindex-skips-unchanged.ts
 *
 * 2026-11-09: loki-reindex ran into its 15-minute TimeoutStartSec with no
 * error. Every run re-embedded every chunk for every user, including ~630
 * identical essay chunks per user, and eight users in it was cut off.
 * upsertKnowledgeBatch now compares each chunk with the stored md5 for the
 * same source and only embeds the ones that differ.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// postgres() connects lazily: this test never issues a query.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const key = (t: string, id: string) => `${t}\u0000${id}`;

async function main() {
  const { partitionByStoredChunk } = await import("../../src/db/queries/knowledge-embeddings");
  type Item = Parameters<typeof partitionByStoredChunk>[0][number];
  const essay: Item = { sourceType: "thought", sourceId: "thought:a#0", chunk: "Essay: A\nsame" };
  const log: Item = {
    sourceType: "dev_log",
    sourceId: "p:devlog",
    chunk: "Dev log for p:\nnew line",
  };
  const fresh: Item = { sourceType: "goal", sourceId: "goal:1", chunk: "Goal: ship" };

  const stored = new Map([
    [key("thought", "thought:a#0"), md5("Essay: A\nsame")],
    [key("dev_log", "p:devlog"), md5("Dev log for p:\nold line")],
  ]);
  const { unchanged, changed } = partitionByStoredChunk([essay, log, fresh], stored);

  check("a chunk whose text matches the stored md5 is not re-embedded", () => {
    assert(unchanged.length === 1 && unchanged[0] === essay, "the unchanged essay must be skipped");
  });
  check("an edited chunk and a new chunk are embedded", () => {
    assert(
      changed.length === 2 && changed.includes(log) && changed.includes(fresh),
      "the changed dev log and the new goal must be embedded",
    );
  });
  check("the same text under another source is not treated as stored", () => {
    const other: Item = { ...essay, sourceType: "repo_doc" };
    assert(
      partitionByStoredChunk([other], stored).changed.length === 1,
      "the match must be per (source_type, source_id)",
    );
  });
  check("an empty index embeds everything", () => {
    assert(partitionByStoredChunk([essay, log], new Map()).changed.length === 2, "nothing stored");
  });
  check("upsertKnowledgeBatch embeds only the changed partition", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "db", "queries", "knowledge-embeddings.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("export async function upsertKnowledgeBatch"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    assert(/partitionByStoredChunk\(/.test(fn), "upsertKnowledgeBatch must partition first");
    assert(
      /embedTexts\(changed\.map/.test(fn) && !/embedTexts\(items/.test(fn),
      "only changed chunks may be sent to the embed server",
    );
  });
  console.log(`\n${passed} passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
