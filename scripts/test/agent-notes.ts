// Profile enrichment reads AGENTS.md; a CLAUDE.md that only points there adds
// nothing, but a repo outside the fleet may still keep real notes in it.
// Run: npx tsx scripts/test/agent-notes.ts
import { agentNotes, readAgentDocs } from "@/lib/agent-notes";

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

ok(
  "'Read and follow [AGENTS.md]' is a pointer too",
  agentNotes("Read and follow [AGENTS.md](AGENTS.md).\n") === null,
);

// readAgentDocs against an in-memory repo.
const repo = (files: Record<string, string>) => async (p: string) => files[p] ?? null;
const labels = (docs: Array<{ label: string }>) => docs.map((d) => d.label).join(",");
const AGENTS = "# Repo\n\nHow to work here: pnpm run verify, Drizzle, deploy on merge.\n";

async function main() {
  ok(
    "AGENTS.md is read and a pointer CLAUDE.md adds nothing",
    labels(await readAgentDocs(repo({ "AGENTS.md": AGENTS, "CLAUDE.md": pointer }))) ===
      "AGENTS.md",
  );
  ok(
    "AGENTS.md comes before real CLAUDE.md notes",
    labels(await readAgentDocs(repo({ "AGENTS.md": AGENTS, "CLAUDE.md": notes }))) ===
      "AGENTS.md,CLAUDE.md",
  );
  ok(
    "a repo without AGENTS.md falls back to CLAUDE.md",
    labels(await readAgentDocs(repo({ "CLAUDE.md": notes }))) === "CLAUDE.md",
  );
  // Solon / DataCat shape: the root file imports .claude/CLAUDE.md.
  const solonRoot =
    "# Solon\n\n**Note**: The main CLAUDE.md file is located at `.claude/CLAUDE.md`\n\n@.claude/CLAUDE.md\n\nOrg rules are [bitbaum/fleet AGENTS.md](https://github.com/bitbaum/fleet/blob/main/AGENTS.md). Read that file.\n";
  const solonInner = "# Solon\n\n" + "Governance models, red lines, the verify gate. ".repeat(20);
  const solon = await readAgentDocs(
    repo({ "AGENTS.md": AGENTS, "CLAUDE.md": solonRoot, ".claude/CLAUDE.md": solonInner }),
  );
  ok(
    "an @import pointer is followed to its target",
    labels(solon) === "AGENTS.md,.claude/CLAUDE.md",
  );
  ok("the followed file's text is read", solon[1]?.text === solonInner.trim());
  // A pointer to a file outside the repo is never followed.
  const reads: string[] = [];
  await readAgentDocs(async (p) => {
    reads.push(p);
    return p === "CLAUDE.md" ? "@../secrets.md\n" : null;
  });
  ok("a pointer cannot climb out of the repo", !reads.some((p) => p.includes("secrets")));
  // .claude/CLAUDE.md pointing back at ../AGENTS.md reads AGENTS.md once.
  const once = await readAgentDocs(
    repo({
      "AGENTS.md": AGENTS,
      "CLAUDE.md": "@.claude/CLAUDE.md\n",
      ".claude/CLAUDE.md": "Read [AGENTS.md](../AGENTS.md).\n",
    }),
  );
  ok("a chain back to AGENTS.md reads it once", labels(once) === "AGENTS.md");
  ok(
    "with neither root file, .claude/CLAUDE.md is the fallback",
    labels(await readAgentDocs(repo({ ".claude/CLAUDE.md": notes }))) === ".claude/CLAUDE.md",
  );
  ok("an empty repo has no agent notes", (await readAgentDocs(repo({}))).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
