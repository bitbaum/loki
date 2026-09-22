/**
 * A badge that implies a vocabulary has to have one.
 *
 * "Stage" rendered the free-text attr `status` with a 13-key colour map and no
 * enum anywhere. Three things followed, all of which George named on sight:
 *
 *   - Nothing constrained the value, so two projects could mean different
 *     things by "Development" and no code would notice.
 *   - A value outside those 13 strings made the badge SILENTLY VANISH
 *     (`shortProjectStatus` returned null), so "Early Stage" was
 *     indistinguishable from a project that had never set a stage.
 *   - There was no list anywhere of what the stages ARE, so the answer to
 *     "what counts as pre-launch?" lived in nobody's head.
 *
 * Every other vocabulary in this product is declared in lib/constants/
 * statuses.ts — goals, sessions, actions, events, feedback, human tasks.
 * Stage simply never joined them. That is the whole defect: not a missing
 * feature, a missing contract.
 *
 * THE RULE THIS PINS: a value the vocabulary cannot resolve must be SHOWN and
 * marked, never swallowed. "This project's stage is a word nobody defined" is
 * a fact the operator should see.
 *
 * Run: npx tsx scripts/test/stage-is-a-real-vocabulary.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  LEGACY_PROJECT_STAGE,
  PROJECT_STAGE,
  PROJECT_STAGE_MEANING,
  PROJECT_STAGES,
  isProjectStage,
  resolveProjectStage,
} from "@/lib/constants/statuses";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("stage-is-a-real-vocabulary:");

check("THE CONTRACT: the vocabulary exists and every stage means something", () => {
  assert(PROJECT_STAGES.length > 0, "no stages defined");
  for (const s of PROJECT_STAGES) {
    assert(isProjectStage(s), `${s} is not recognised by its own guard`);
    const meaning = PROJECT_STAGE_MEANING[s];
    assert(Boolean(meaning) && meaning.endsWith("."), `${s} has no written meaning`);
  }
  // Every declared constant is in the ordered list — a stage that exists but
  // is not offered is a stage nobody can set.
  for (const v of Object.values(PROJECT_STAGE)) {
    assert(PROJECT_STAGES.includes(v), `${v} is declared but not offered in PROJECT_STAGES`);
  }
});

check("the order is life order, not alphabetical", () => {
  // The order IS the meaning; a picker built from it should read as a
  // progression. Alphabetical would put "archived" first.
  const sorted = [...PROJECT_STAGES].sort();
  assert(
    PROJECT_STAGES.join(",") !== sorted.join(","),
    "stages are in alphabetical order — the progression has been lost",
  );
  assert(PROJECT_STAGES[0] === PROJECT_STAGE.IDEA, "life order should start at idea");
  assert(
    PROJECT_STAGES[PROJECT_STAGES.length - 1] === PROJECT_STAGE.ARCHIVED,
    "life order should end at archived",
  );
});

check("real values from the data resolve", () => {
  // These are what /projects actually showed on 2026-09-22.
  assert(resolveProjectStage("Production") === PROJECT_STAGE.PRODUCTION, "Production");
  assert(resolveProjectStage("Development") === PROJECT_STAGE.DEVELOPMENT, "Development");
  assert(resolveProjectStage("Live") === PROJECT_STAGE.PRODUCTION, "Live should mean production");
  assert(
    resolveProjectStage("Early Stage") === PROJECT_STAGE.DEVELOPMENT,
    "Early Stage should mean development",
  );
});

check("prose resolves on its first clause", () => {
  // Stored values are sentences as often as labels.
  assert(
    resolveProjectStage("Production — payments live, shop pending") === PROJECT_STAGE.PRODUCTION,
    "an em-dash clause defeated resolution",
  );
  assert(
    resolveProjectStage("Development, not usable yet") === PROJECT_STAGE.DEVELOPMENT,
    "a comma clause defeated resolution",
  );
});

check("THE RULE: an unknown value is NOT swallowed", () => {
  // Returning null is the honest answer, and the caller must render the raw
  // text marked unrecognised. Mapping it to something plausible would be
  // worse than saying nothing.
  assert(resolveProjectStage("MVP") === null, "MVP was silently mapped to a stage");
  assert(resolveProjectStage("¯\\_(ツ)_/¯") === null, "junk was mapped to a stage");
  assert(resolveProjectStage("") === null, "empty resolved to a stage");
  assert(resolveProjectStage(null) === null, "null resolved to a stage");
});

check("legacy mapping is explicit, never fuzzy", () => {
  // Each entry must be a value actually seen in the data, and must point at a
  // real stage. A fuzzy normaliser here would invent meaning.
  for (const [legacy, stage] of Object.entries(LEGACY_PROJECT_STAGE)) {
    assert(isProjectStage(stage), `legacy "${legacy}" maps to non-stage "${stage}"`);
    assert(
      !PROJECT_STAGES.includes(legacy as never),
      `"${legacy}" is a real stage and does not belong in the legacy map`,
    );
  }
});

check("the badge renders unknown stages instead of hiding them", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/projects/project-badges.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  assert(src.includes("resolveProjectStage"), "StatusBadge does not use the vocabulary");
  assert(
    /stage \?\? value/.test(src),
    "the badge does not fall back to the raw value — an unknown stage would render blank",
  );
});

check("THE OLD GATE IS GONE: the row no longer filters stages through a 13-string list", () => {
  const row = readFileSync(
    join(process.cwd(), "src/components/projects/ProjectRow.tsx"),
    "utf8",
  ).replace(/\/\/.*$/gm, "");
  assert(
    !/statusLabel\s*=\s*shortProjectStatus/.test(row),
    "the row still passes the stage through shortProjectStatus, which returns null for anything unlisted",
  );
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
