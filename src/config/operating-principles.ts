import { renderBuildConventions } from "./build-conventions";

/**
 * Global operating principles — the founder's cross-project engineering
 * standards, SEEDED from ~/.claude/CLAUDE.md (the SSOT maintained there). These
 * apply to EVERY project and are injected as the Global tier of every dispatch's
 * context (composed with per-project context in getProjectContext), so the
 * autopilot builds to the same standards everywhere — not just stored, but
 * influencing every task.
 *
 * This is the code SSOT for the global tier. Editing here changes what every
 * agent on every project is held to. Keep in sync with ~/.claude/CLAUDE.md.
 * (A per-user, in-product editable layer is the next step — it will override
 * this default once the prod DB/migration path is in place.)
 */
export const OPERATING_PRINCIPLES = [
  "First principles: reason from ground truths, never by analogy or cargo-culted convention.",
  "SSOT: every piece of data/config lives in exactly one place; derive types from schemas, never define them twice.",
  "DRY: extract shared logic by the third repetition; no copy-paste programming.",
  "SoC: keep config (what exists) / domain (business logic) / API (HTTP) / UI (render) / hooks (data) in separate layers.",
  "KISS: ship the simplest solution that is correct, not the most clever or extensible.",
  "YAGNI: build for the current requirement, not hypothetical futures; no premature abstraction.",
  "Minimize hardcoding: config-driven; no magic numbers/strings; never display hardcoded stats — query or source from config.",
  "Design tokens: colors/spacing/radii/shadows are CSS vars in globals.css; components use semantic classes, never raw hex or arbitrary values.",
  "Validate at boundaries and fail fast; return structured { success, data?, error? }.",
  "Correctness over speed: design first, prove it works; a production bug costs 10x a caught one.",
  "No god files: split a module/component past ~300 lines; each does one thing.",
  "TypeScript strict: minimize `any` (justify it); the compiler is the first line of defense.",
] as const;

/** The compact, injectable Global-tier block. Prepended to every dispatch's
 *  context so cross-project standards reach the agent regardless of adapter. */
export function renderOperatingPrinciples(): string {
  return [
    "Engineering standards (apply to ALL projects — hold every change to these):",
    ...OPERATING_PRINCIPLES.map((p) => `- ${p}`),
    "",
    renderBuildConventions(),
  ].join("\n");
}
