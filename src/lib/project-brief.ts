import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { callGroqText } from "@/lib/groq";
import { db } from "@/db";
import { attributes, entities } from "@/db/schema";
import { SOURCE_LOKI_UI } from "@/lib/constants";
import { patchProject } from "@/db/queries/projects";
import { syncUserProjectDescription } from "@/db/queries/user-projects";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { PROJECT_AI_FILL_KEYS } from "@/config/project-attrs";
import { hasAnswer } from "@/lib/project-display";
import { parseModelJson } from "@/lib/ai/model-json";

/**
 * AI-powered project profile extraction — the "no forms" path.
 *
 * People hate filling out forms. Instead of asking for mission/vision/
 * customers/stack field by field, the user writes (or dictates) what they
 * want the project to be in free form — or we read the project's own README —
 * and the model fills the profile. The output lands in the exact same SSOT
 * the form would write to: entities.description + the attributes table, so
 * everything downstream (project workspace, control cards, dispatch context)
 * sees it with zero new storage.
 *
 * Both intake routes (/api/projects/[id]/brief for free text,
 * /api/projects/[id]/enrich for repo READMEs) funnel through here.
 */

/** Profile fields the extractor may fill. Mirrors the canonical workspace fields. */
const FIELD_LIMIT = 500;

export const ExtractedProfileSchema = z.object({
  description: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  mission: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  vision: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  customers: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  stack: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  status: z.string().trim().min(1).max(60).optional(),
  next_step: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  // Build-execution lens — how an agent should build this project correctly.
  // Injected into every autopilot dispatch (project-context.ts DRIVING_FIELDS),
  // so the project is driven in the right direction without re-deriving each run.
  architecture: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  conventions: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  definition_of_done: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  // Distribution & go-to-market — how the project reaches people and gets
  // paid. First-class agent context (dossier + DRIVING_FIELDS), not market lens.
  distribution: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  gtm: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  // Market lens — the "nerd out on your project" dimensions. Same storage
  // (attributes table), so they're inline-editable like everything else.
  problem: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  solution: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  current_alternatives: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  competitors: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  complements_substitutes: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  partnerships: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  potential_customers: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
  expansion_ideas: z.string().trim().min(1).max(FIELD_LIMIT).optional(),
});

export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

// The two reach keys are named once and reused by both the full profile prompt
// and the narrow reach-only extraction, so their definition can never drift.
const DISTRIBUTION_KEY_SPEC = `- "distribution": the channels through which this project reaches people TODAY — RSS/newsletter, social accounts or queues, OG cards/SEO, marketplaces (max 400 chars). Only from the text; omit if unknown.`;
const GTM_KEY_SPEC = `- "gtm": go-to-market — ideal customer profile, path to the first paying customer, current monetization state, key metrics if stated (max 400 chars). Only from the text; omit if unknown.`;

const SYSTEM_PROMPT = `You turn free-form notes about a software/business project into a structured profile.
Respond with ONLY a JSON object — no prose, no markdown fences. Allowed keys:
- "description": what the project is, 1-2 plain sentences (max 400 chars)
- "mission": why it exists — the problem it solves and for whom (max 400 chars)
- "vision": what it should become at full ambition (max 400 chars)
- "customers": who it serves / who pays (max 300 chars)
- "stack": technologies used, comma-separated (max 200 chars)
- "status": current state in 1-4 words, e.g. "Production", "MVP", "Idea" (max 40 chars)
- "next_step": the owner's single most important next build/business action (max 300 chars) — never installation or usage instructions aimed at readers
- "architecture": the key building blocks and how they fit — main modules/services, data stores, external integrations (max 400 chars). Only from the text/README; omit if unknown.
- "conventions": how this project is built — patterns, rules, do's and don'ts an engineer must follow (e.g. "Drizzle not Prisma", "server components by default", "never edit generated files") (max 400 chars). Only from the text/README; omit if unknown.
- "definition_of_done": the bar ONE TURN of work must clear to be finished, phrased so a reviewer reading only the handoff can tell whether it was met — e.g. "\`npm run verify\` passes, with its real output in the handoff; work committed and pushed" (max 300 chars). It must name checkable actions, never describe the finished product ("outcomes are tracked", "money is not a float", "live and profitable" are all WRONG — no single turn can evidence them, so every run gets graded a failure). Prefer naming the repo's own verify/test command over listing individual tools. Only from the text/README; omit if unknown.
${DISTRIBUTION_KEY_SPEC}
${GTM_KEY_SPEC}
- "problem": the concrete problem being solved, from the user's point of view (max 400 chars)
- "solution": how this project solves that problem — the offered approach (max 400 chars)
- "current_alternatives": how people solve this problem today without the project (max 400 chars)
- "competitors": direct competitors, comma-separated, with a word on each if known (max 400 chars)
- "complements_substitutes": products that complement it or could substitute for it (max 400 chars)
- "partnerships": potential partnerships and synergies — including with the owner's other projects when the text mentions them (max 400 chars)
- "potential_customers": customer segments worth pursuing beyond current ones (max 400 chars)
- "expansion_ideas": plausible product expansions or adjacent offerings (max 400 chars)
For the market-lens keys (problem … expansion_ideas) you may reason from the text plus common knowledge of the market, but stay concrete and grounded — no hype. For all other keys, NEVER invent facts that are not in the text.
Omit any key you have no basis for. Write in the same language as the source text uses for prose (default English).`;

/** Clamp every string field to its schema max instead of rejecting — the
 *  model occasionally runs a few chars over and a hard fail wastes the call.
 *
 *  Also drops non-answers. Asked for 17 named fields from a thin description,
 *  the model fills the ones it cannot infer with "Unknown" instead of omitting
 *  them — the prompt only says "omit if unknown" on three. A stored "Unknown"
 *  is worse than an absent field: it is truthy, so it satisfies every
 *  "is this filled?" check downstream and briefs agents with "STACK: Unknown".
 *  Dropping it here means no prompt wording has to be trusted for the data to
 *  stay honest. */
function clampFields(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const limits: Record<string, number> = { status: 60 };
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && !hasAnswer(v)) continue;
    out[key] = typeof v === "string" ? v.slice(0, limits[key] ?? FIELD_LIMIT) : v;
  }
  return out;
}

/**
 * Extract a structured profile from free-form text (user brief, README, …).
 * Throws on Groq/parse failure — callers map that to a 502.
 */
export async function extractProjectProfile(
  projectName: string,
  sourceText: string,
): Promise<ExtractedProfile> {
  const prompt = `Project name: ${projectName}\n\nSource text:\n${sourceText.slice(0, 12_000)}`;
  let raw = "";
  // Groq free tier rate-limits in bursts; one bounded retry absorbs the
  // common 429 without turning a user-facing request into a hang.
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await callGroqText(prompt, {
        feature: "project-brief",
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 900,
        temperature: 0.2,
        timeoutMs: 25_000,
      });
      break;
    } catch (e) {
      const is429 = e instanceof Error && e.message.includes("429");
      if (!is429 || attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  const parsed = ExtractedProfileSchema.safeParse(clampFields(parseModelJson(raw)));
  if (!parsed.success)
    throw new Error(
      `model output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  return parsed.data;
}

// ── Roadmap decomposition (spec → milestones) ────────────────────────────────
// The brief flow fills flat fields; this turns a spec into an ordered build
// roadmap the caller creates as project goals. This is the "decompose the doc"
// half of spec ingestion.

const REACH_SYSTEM_PROMPT = `You extract how a software/business project reaches people and makes money.
Respond with ONLY a JSON object — no prose, no markdown fences. Allowed keys:
${DISTRIBUTION_KEY_SPEC}
${GTM_KEY_SPEC}
NEVER invent facts that are not in the text. If the text says a channel does not exist yet, say so plainly rather than describing it as if it did.
Omit any key you have no basis for. Write in the same language as the source text uses for prose (default English).`;

/**
 * Extract ONLY distribution + go-to-market.
 *
 * A backfill that writes two fields should not pay for twenty: the full profile
 * prompt costs ~5x the tokens per project in and out, and Groq's free tier caps
 * tokens PER DAY — one whole-fleet pass on the full prompt exhausts the day's
 * budget on its own. Same key definitions, same clamping, same schema subset.
 */
export async function extractReachProfile(
  projectName: string,
  sourceText: string,
): Promise<ExtractedProfile> {
  const prompt = `Project name: ${projectName}\n\nSource text:\n${sourceText.slice(0, 12_000)}`;
  const raw = await callGroqText(prompt, {
    feature: "project-brief",
    systemPrompt: REACH_SYSTEM_PROMPT,
    maxTokens: 300,
    temperature: 0.2,
    timeoutMs: 25_000,
  });
  const parsed = ExtractedProfileSchema.pick({ distribution: true, gtm: true }).safeParse(
    clampFields(parseModelJson(raw)),
  );
  if (!parsed.success)
    throw new Error(
      `model output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  return parsed.data;
}

export const RoadmapSchema = z.object({
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        // Description carries the acceptance criteria — the bar that milestone
        // must clear — so each goal is verifiable, not vague.
        description: z.string().trim().max(500).optional(),
      }),
    )
    .max(8),
});
export type Roadmap = z.infer<typeof RoadmapSchema>;

const ROADMAP_SYSTEM = `You turn a product/engineering spec into an ordered BUILD ROADMAP.
Respond with ONLY a JSON object — no prose, no markdown fences:
{"milestones":[{"title":"...","description":"..."}]}

Rules:
- 3 to 7 milestones, ordered so each builds on the last and is independently shippable.
- "title": one imperative line naming the deliverable (max 100 chars), e.g. "Define the core data model".
- "description": 1-2 sentences INCLUDING the acceptance criteria — the objective bar that milestone must clear to be done (max 400 chars).
- Derive from the spec's own roadmap/phases/milestones if it states them; otherwise infer a sensible build order from its scope.
- Milestones are engineering deliverables, not marketing. No installation/usage instructions.`;

// ── Reconcile (sync fields from an updated doc) ───────────────────────────────
// Instead of overwriting every field, diff the project's CURRENT fields against
// an updated doc and return a PATCH: only the fields whose value should change,
// plus up to 3 proposed NEW attributes for important facts that don't fit the
// existing schema. The caller previews this and applies only what the user OKs —
// so manual edits survive and nothing is silently clobbered.

export const ReconcilePatchSchema = z.object({
  // Only fields whose value should change, keyed by existing field/attribute key.
  updates: z.record(z.string(), z.string().trim().min(1).max(FIELD_LIMIT)).default({}),
  // Proposed new custom attributes — capped, snake_case, user-approved before write.
  newAttributes: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "key must be snake_case"),
        label: z.string().trim().min(1).max(60),
        value: z.string().trim().min(1).max(FIELD_LIMIT),
      }),
    )
    .max(3)
    .default([]),
});
export type ReconcilePatch = z.infer<typeof ReconcilePatchSchema>;

const RECONCILE_SYSTEM = `You reconcile a project's structured fields with an UPDATED document.
You are given the CURRENT fields ("key: value" per line) and the UPDATED doc. Return ONLY a JSON patch:
{"updates": {"<existing_key>": "<new value>"}, "newAttributes": [{"key":"snake_case","label":"Human Label","value":"..."}]}

Rules:
- "updates": include ONLY fields whose value should CHANGE given the doc. OMIT unchanged fields entirely. Never touch a field the doc doesn't speak to. Keep each value concise (max 400 chars), matching the existing style.
- "newAttributes": propose AT MOST 3 new fields for important facts in the doc that fit no existing key (e.g. pricing_model, moat, compliance, go_to_market). snake_case key + short human label. Omit if nothing warrants it.
- Never invent facts absent from the doc. Never delete fields.`;

/** Diff current fields against an updated doc → a patch (changed fields + proposed new ones). Throws on Groq/parse failure. */
export async function reconcileProfile(
  projectName: string,
  currentFields: Record<string, string>,
  newDoc: string,
): Promise<ReconcilePatch> {
  const current = Object.entries(currentFields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const prompt = `Project: ${projectName}\n\nCURRENT FIELDS:\n${current || "(none yet)"}\n\nUPDATED DOC:\n${newDoc.slice(0, 12_000)}`;
  let raw = "";
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await callGroqText(prompt, {
        feature: "project-brief",
        systemPrompt: RECONCILE_SYSTEM,
        maxTokens: 1600,
        temperature: 0.2,
        timeoutMs: 25_000,
      });
      break;
    } catch (e) {
      const is429 = e instanceof Error && e.message.includes("429");
      if (!is429 || attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  const parsed = ReconcilePatchSchema.safeParse(parseModelJson(raw));
  if (!parsed.success)
    throw new Error(
      `reconcile output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  return parsed.data;
}

/** Extract an ordered build roadmap (milestones) from spec text. Throws on Groq/parse failure. */
export async function extractRoadmap(projectName: string, sourceText: string): Promise<Roadmap> {
  const prompt = `Project name: ${projectName}\n\nSpec:\n${sourceText.slice(0, 12_000)}`;
  let raw = "";
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await callGroqText(prompt, {
        feature: "project-brief",
        systemPrompt: ROADMAP_SYSTEM,
        maxTokens: 1200,
        temperature: 0.2,
        timeoutMs: 25_000,
      });
      break;
    } catch (e) {
      const is429 = e instanceof Error && e.message.includes("429");
      if (!is429 || attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  const parsed = RoadmapSchema.safeParse(parseModelJson(raw));
  if (!parsed.success)
    throw new Error(
      `roadmap output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  return parsed.data;
}

export type ApplyProfileOptions = {
  /** Never overwrite a field that already holds text. Off by default. */
  onlyMissing?: boolean;
};

/**
 * Current description + attribute values, keyed the same way an ExtractedProfile
 * is, so `onlyMissing` can ask one question per field: is this already answered?
 */
async function readExistingProfileValues(
  userId: string,
  entityId: string,
): Promise<Record<string, string | null>> {
  const [[core], rows] = await Promise.all([
    db
      .select({ description: entities.description })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.userId, userId))),
    db
      .select({ key: attributes.key, value: attributes.value })
      .from(attributes)
      .where(and(eq(attributes.userId, userId), eq(attributes.entityId, entityId))),
  ]);
  const out: Record<string, string | null> = { description: core?.description ?? null };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/**
 * Write an extracted profile to the project's SSOT: description on the
 * entity row, everything else as attributes. Returns the applied fields
 * (so the UI can show exactly what was set) or null when the entity
 * doesn't exist / isn't the user's.
 */
export async function applyProjectProfile(
  userId: string,
  entityId: string,
  profile: ExtractedProfile,
  options: ApplyProfileOptions = {},
): Promise<Partial<Record<keyof ExtractedProfile, string>> | null> {
  const applied: Partial<Record<keyof ExtractedProfile, string>> = {};
  // Nothing is skipped by default — kickoff fills attrs from the brief. The
  // brief route forces description to the operator's exact text before apply,
  // so a model paraphrase cannot overwrite what they just edited. `onlyMissing`
  // is for callers that fill gaps in a profile someone already worked on.
  const existing = options.onlyMissing ? await readExistingProfileValues(userId, entityId) : null;
  // hasAnswer, not a bare emptiness test: it is the same predicate
  // computeProjectHealth uses, so "already answered" means exactly what the
  // health check means by it. Anything else and a fill could overwrite a field
  // the score already counted, or skip one it did not.
  const occupied = (key: string) => Boolean(existing && hasAnswer(existing[key] ?? undefined));

  if (profile.description && !occupied("description")) {
    const updated = await patchProject(userId, entityId, { description: profile.description });
    if (!updated) return null;
    applied.description = profile.description;
    // Mirror the brief onto the projects-page one-liner so the fleet index (which
    // reads user_projects.description) reflects saved context too, not just the
    // dossier/RAG (which read the entity). Best-effort — never fail the save.
    await syncUserProjectDescription(userId, entityId, profile.description).catch(() => {});
  }

  // DERIVED from the field registry (config/project-attrs.ts): every field
  // marked `aiFill`. The model returns a partial profile, so index it as a bag
  // of optional strings rather than restating the key list a second time here.
  const filled = profile as Record<string, string | undefined>;

  const entries = PROJECT_AI_FILL_KEYS.flatMap((key) => {
    const value = filled[key];
    return value && !occupied(key) ? [[key, value] as const] : [];
  });

  if (entries.length > 0) {
    // One owner check + one transaction — avoids 17 round trips over a remote DB
    // (the enrich-prod-profiles script was hitting ETIMEDOUT mid-apply).
    const [owner] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
    if (!owner) return null;

    await db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        const normalized = key.toLowerCase().replace(/\s+/g, "_");
        await tx
          .insert(attributes)
          .values({
            userId,
            entityId,
            key: normalized,
            value,
            source: SOURCE_LOKI_UI,
          })
          .onConflictDoUpdate({
            target: [attributes.userId, attributes.entityId, attributes.key],
            set: { value, updatedAt: new Date() },
          });
        // Same bag-of-optional-strings treatment as `filled` above: the key
        // list is the registry's, which is wider than this object's literal
        // union. `aiFillKeysMatchProfileSchema` pins the two together.
        (applied as Record<string, string | undefined>)[key] = value;
      }
    });
  }

  scheduleProjectProfileReindexByEntityId(userId, entityId);
  return applied;
}
