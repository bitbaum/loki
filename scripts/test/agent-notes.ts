// Profile enrichment reads AGENTS.md; a CLAUDE.md that only points there adds
// nothing, but a repo outside the fleet may still keep real notes in it.
// Run: npx tsx scripts/test/agent-notes.ts
import { agentNotes } from "@/lib/agent-notes";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

const pointer =
  "Read [AGENTS.md](AGENTS.md). It points at `bitbaum/fleet` `AGENTS.md`, which\nevery agent reads; nothing here restates either.\n";
ok("the fleet pointer is dropped", agentNotes(pointer) === null);
ok("an @AGENTS.md import is dropped", agentNotes("@AGENTS.md\n") === null);
ok("a missing file stays missing", agentNotes(null) === null);
const notes = "# Acme\n\nA booking site for a bakery. Next.js, Postgres, deployed on the box.\n";
ok("real notes are kept", agentNotes(notes) === notes);
const long = pointer + "\n## Local notes\n" + "x".repeat(500);
ok("a pointer followed by real notes is kept", agentNotes(long) === long);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
