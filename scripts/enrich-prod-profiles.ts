// Backfill prod project profiles from local repo docs.
//
// The user's repos already say what each project is — the Loki profiles
// shouldn't be emptier than the repos. This script runs the same extraction
// pipeline as POST /api/projects/[id]/brief, but sourced from local docs and
// pointed at the production (Hetzner) database. Sources per project, each
// included when present: ~/dev/<project>/README.md, ~/dev/<project>/AGENTS.md,
// ~/dev/<project>/CLAUDE.md (only when it is more than a pointer to AGENTS.md),
// ~/dev/bitbaum/projects/<project>.md (operator notes), and the newest
// gtm*.md under ~/dev/<project>/docs/ (recursive, case-insensitive).
//
// Usage:
//   npx tsx scripts/enrich-prod-profiles.ts                       # dry run (no writes)
//   npx tsx scripts/enrich-prod-profiles.ts --apply               # write to prod
//   npx tsx scripts/enrich-prod-profiles.ts --apply --update-gtm  # write ONLY the
//       distribution + gtm attrs — safe on already-filled projects, nothing
//       else is touched
//
// Env: GROQ_API_KEY from .env.local; DB password from .env.hetzner.local.
// Description is only set when currently empty — attrs are upserted (that's
// the point of the backfill). Existing attr keys outside the profile set are
// never touched.
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { config } from "dotenv";
import { agentNotes } from "../src/lib/agent-notes";

config({ path: ".env.local" });
config({ path: ".env.hetzner.local" });

const APPLY = process.argv.includes("--apply");
// Restrict writes to the distribution + gtm attrs. Projects enriched before
// those keys existed are "full" everywhere else — this backfills just the new
// context without re-deciding any other field.
const UPDATE_GTM = process.argv.includes("--update-gtm");
// Print what the run would cost and exit. Groq's free tier caps tokens per DAY,
// so knowing the bill before paying it is the difference between one clean pass
// and a half-finished fleet waiting on a reset.
const ESTIMATE = process.argv.includes("--estimate");
// Optional positional args narrow the run to specific project names
// (e.g. retrying transient extraction failures).
const ONLY = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.toLowerCase());
const DEV_ROOT = join(homedir(), "dev");

// entities.name (prod) → local repo dir under ~/dev. Identity-cased names
// are matched case-insensitively against ~/dev automatically; this map only
// covers genuinely different names.
const NAME_TO_DIR_OVERRIDES: Record<string, string> = {
  "revamp-it": "revampit",
  bitbaum: "bitbaum",
  "prime tower": "prime-tower",
};

const PLACEHOLDER_DESCRIPTION = /^local repository imported from/i;

function isPlaceholderDescription(description: string | null | undefined): boolean {
  const t = description?.trim();
  return !t || PLACEHOLDER_DESCRIPTION.test(t);
}

function localDirFor(name: string): string | null {
  const dirs = readdirSync(DEV_ROOT);
  const target = (NAME_TO_DIR_OVERRIDES[name.toLowerCase()] ?? name).toLowerCase();
  const hit = dirs.find((d) => d.toLowerCase() === target);
  return hit ? join(DEV_ROOT, hit) : null;
}

function readDoc(path: string): string | null {
  try {
    return readFileSync(path, "utf-8").slice(0, 8000);
  } catch {
    return null;
  }
}

/** ~/dev/bitbaum/projects/<name>.md — the operator's per-project notes. */
function bitbaumNotePath(name: string): string | null {
  const notesDir = join(DEV_ROOT, "bitbaum", "projects");
  if (!existsSync(notesDir)) return null;
  const target = `${(NAME_TO_DIR_OVERRIDES[name.toLowerCase()] ?? name).toLowerCase()}.md`;
  try {
    const hit = readdirSync(notesDir).find((f) => f.toLowerCase() === target);
    return hit ? join(notesDir, hit) : null;
  } catch {
    return null;
  }
}

/** Newest gtm*.md anywhere under <dir>/docs — covers docs/GTM.md,
 *  docs/gtm-plan.md, docs/strategy/gtm.md. Newest wins when several exist. */
function newestGtmDocPath(dir: string): string | null {
  const docsDir = join(dir, "docs");
  if (!existsSync(docsDir)) return null;
  try {
    const hits = (readdirSync(docsDir, { recursive: true }) as string[])
      .filter((f) => typeof f === "string" && /^gtm.*\.md$/i.test(basename(f)))
      .map((f) => join(docsDir, f))
      .flatMap((p) => {
        try {
          return [{ path: p, mtimeMs: statSync(p).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return hits[0]?.path ?? null;
  } catch {
    return null;
  }
}

/** All available docs for a project, labeled so extraction sees provenance.
 *  `dir` is null for projects with no local repo — those still enrich from the
 *  operator brief alone, which is where distribution/GTM is written down. */
function collectSources(name: string, dir: string | null): Array<{ label: string; text: string }> {
  const candidates: Array<{ label: string; path: string }> = [];
  if (dir) {
    candidates.push(
      { label: "README.md", path: join(dir, "README.md") },
      { label: "AGENTS.md", path: join(dir, "AGENTS.md") },
      { label: "CLAUDE.md", path: join(dir, "CLAUDE.md") },
    );
  }
  const note = bitbaumNotePath(name);
  if (note) candidates.push({ label: `bitbaum/projects/${basename(note)}`, path: note });
  const gtm = dir ? newestGtmDocPath(dir) : null;
  if (gtm) candidates.push({ label: `docs/…/${basename(gtm)}`, path: gtm });

  return candidates.flatMap(({ label, path }) => {
    if (!existsSync(path)) return [];
    const read = readDoc(path);
    const text = label === "CLAUDE.md" ? agentNotes(read) : read;
    return text ? [{ label, text }] : [];
  });
}

// Groq's free tier caps llama-3.3-70b at 12k tokens/minute, and one extraction
// spends ~7k (four 8k-char sources + the prompt). Two calls in the same minute
// is a guaranteed 429 — so pace on a real token budget, not a fixed sleep.
const TPM_BUDGET = 10_000; // headroom under the 12k limit
const spent: Array<{ at: number; tokens: number }> = [];

/** Sleep until `tokens` fit inside the trailing-60s budget. */
async function reserveTokens(tokens: number): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0].at > 60_000) spent.shift();
    const used = spent.reduce((s, e) => s + e.tokens, 0);
    if (used + tokens <= TPM_BUDGET || !spent.length) break;
    const waitMs = 60_000 - (now - spent[0].at) + 500;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  spent.push({ at: Date.now(), tokens });
}

// Groq also caps tokens PER DAY (100k on the free tier) and a full-document
// pass over the fleet costs almost exactly that. In --update-gtm mode only two
// fields are written, so only the sections that could inform them are sent —
// which turns a whole-day budget into a few thousand tokens.
const REACH_HEADING =
  /^#{1,6}\s*.*(distribution|go-to-market|gtm|marketing|business model|pricing|revenue|customers?|audience|positioning)/i;

/** Markdown sections whose heading is about reach; whole doc head as fallback. */
function sliceReachSections(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let depth = 0; // heading level of the section being kept, 0 = not keeping
  for (const line of lines) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (REACH_HEADING.test(line)) {
        depth = level;
        out.push(line);
        continue;
      }
      // A heading at or above the kept section's level ends it.
      if (depth && level <= depth) depth = 0;
      if (depth) out.push(line);
      continue;
    }
    if (depth) out.push(line);
  }
  const kept = out.join("\n").trim();
  return kept.length > 200 ? kept : text.slice(0, 2000);
}

/** ~4 chars per token, plus the system prompt and the answer, both of which
 *  count against the limits. The reach-only prompt is a fraction of the full one. */
const estimateTokens = (docs: string) => Math.ceil(docs.length / 4) + (UPDATE_GTM ? 550 : 1500);

/** Groq puts the wait in the 429 body ("try again in 12.3s"). Honor it, but cap
 *  it: a per-DAY limit reports an hour-long wait, and a run that sleeps through
 *  it looks identical to a hung one. Better to fail and be re-run by name. */
const MAX_RETRY_WAIT_MS = 5 * 60_000;
function retryDelayMs(message: string): number {
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(message);
  if (!m) return 65_000;
  const ms = (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + 1000;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

async function main() {
  // Prefer a tunnel URL when one is set: prod Postgres is firewalled to the
  // box (direct :5432 times out off-box), so `eval "$(bash scripts/db-tunnel.sh)"`
  // is the normal way to run this from a laptop.
  if (process.env.AUDIT_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.AUDIT_DATABASE_URL;
  } else if (!process.env.DATABASE_URL) {
    const password = process.env.LOKI_DB_PASSWORD;
    const host = process.env.HETZNER_IP;
    if (!password || !host)
      throw new Error("LOKI_DB_PASSWORD / HETZNER_IP missing from .env.hetzner.local");
    // Point the app's db module at prod BEFORE importing it.
    process.env.DATABASE_URL = `postgres://loki:${encodeURIComponent(password)}@${host}:5432/loki?sslmode=require`;
  }

  const { db } = await import("../src/db");
  const { entities, users } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { extractProjectProfile, extractReachProfile, applyProjectProfile } =
    await import("../src/lib/project-brief");
  const extract = UPDATE_GTM ? extractReachProfile : extractProjectProfile;

  const allUsers = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users);
  console.log(
    `prod users: ${allUsers.map((u) => `${u.name ?? "?"} <${u.email ?? "?"}>`).join(" · ")}`,
  );

  const projects = await db
    .select({
      id: entities.id,
      userId: entities.userId,
      name: entities.name,
      description: entities.description,
    })
    .from(entities)
    .where(eq(entities.type, "project"));
  console.log(`prod projects: ${projects.length}\n`);

  let enriched = 0;
  let budget = 0;
  for (const p of projects) {
    if (ONLY.length && !ONLY.includes(p.name.toLowerCase())) continue;
    const dir = localDirFor(p.name);
    const sources = collectSources(p.name, dir);
    if (!sources.length) {
      console.log(`— ${p.name}: no repo and no operator brief, skipped`);
      continue;
    }
    const body = sources
      .map((s) => `### SOURCE: ${s.label}\n\n${UPDATE_GTM ? sliceReachSections(s.text) : s.text}`)
      .join("\n\n---\n\n");
    // The stored description grounds the model when the sliced sections are thin.
    const docs =
      p.description?.trim() && UPDATE_GTM
        ? `### SOURCE: current profile\n\n${p.description.trim()}\n\n---\n\n${body}`
        : body;
    const cost = estimateTokens(docs);
    console.log(`  ${p.name} sources: ${sources.map((s) => s.label).join(" + ")} (${cost} tok)`);
    if (ESTIMATE) {
      budget += cost;
      enriched++;
      continue;
    }

    let profile;
    for (let attempt = 0; ; attempt++) {
      await reserveTokens(estimateTokens(docs));
      try {
        profile = await extract(p.name, docs);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A per-DAY limit is not transient: no amount of waiting inside this run
        // recovers it, and grinding 5 retries x 22 projects turns a dead budget
        // into nine hours of pretending. Stop, say so, and be re-run tomorrow.
        if (msg.includes("tokens per day") || msg.includes("(TPD)")) {
          const wait = /try again in ([^"]+?)\./.exec(msg)?.[1] ?? "?";
          console.log(
            `\n✗ Groq daily token budget exhausted (retry in ${wait}). Stopping after ${enriched} project(s).`,
          );
          console.log(
            `  Resume with: npx tsx scripts/enrich-prod-profiles.ts --apply${UPDATE_GTM ? " --update-gtm" : ""} <names…>`,
          );
          process.exit(1);
        }
        const transient =
          msg.includes("fetch failed") || msg.includes("429") || msg.includes("groq 5");
        if (!transient || attempt >= 4) {
          console.log(`✗ ${p.name}: extraction failed (${msg.slice(0, 160)})`);
          profile = undefined;
          break;
        }
        const wait = retryDelayMs(msg);
        console.log(
          `… ${p.name}: retrying in ${Math.round(wait / 1000)}s after ${msg.slice(0, 200)}`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (!profile) continue;
    // --update-gtm: only the two new attrs may be written — everything else
    // the extractor produced is discarded before it can touch a filled profile.
    if (UPDATE_GTM) {
      profile = {
        ...(profile.distribution ? { distribution: profile.distribution } : {}),
        ...(profile.gtm ? { gtm: profile.gtm } : {}),
      };
    }
    // Keep a human-written description; replace import placeholders.
    if (p.description?.trim() && !isPlaceholderDescription(p.description)) {
      delete profile.description;
    }

    const fields = Object.entries(profile).filter(([, v]) => v);
    if (!fields.length) {
      console.log(`— ${p.name}: nothing extracted, skipped`);
      continue;
    }

    console.log(`${APPLY ? "✚" : "DRY"} ${p.name} (${dir?.split("/").pop() ?? "brief only"}):`);
    for (const [k, v] of fields) console.log(`    ${k} = ${String(v).slice(0, 100)}`);

    if (APPLY) {
      const applied = await applyProjectProfile(p.userId, p.id, profile);
      if (!applied) {
        console.log(`✗ ${p.name}: apply failed`);
        continue;
      }
    }
    enriched++;
  }

  if (ESTIMATE) {
    console.log(
      `\nestimate: ${enriched}/${projects.length} projects, ~${budget} input tokens (Groq free tier: 100k/day)`,
    );
    process.exit(0);
  }
  console.log(`\n${APPLY ? "applied" : "would apply"}: ${enriched}/${projects.length} projects`);
  // entities.userId ownership is enforced inside applyProjectProfile; nothing
  // is written for users other than each entity's owner.
  void and;
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
