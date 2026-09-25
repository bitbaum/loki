/**
 * Does every model id this app pins still EXIST at its provider?
 *
 * SSOT for model-rot detection. Two callers share it — `npm run check:models`
 * (a human types it) and the `check-model-ids` cron (the clock types it) — so
 * the scheduled check and the manual one can never disagree about what "rot"
 * means. That mattered here: the previous answer to model rot was a script
 * someone had to remember to run, and `llama-3.3-70b-versatile` was dead for
 * eight days because nobody did.
 *
 * Costs ZERO tokens: one GET /models per provider, no inference. That is the
 * whole reason it is safe to schedule — the Groq free tier is 100k tokens/DAY
 * org-wide, shared by every feature, so a monitor that spends tokens competes
 * with the product for the resource it is supposed to protect.
 */

import {
  REGISTERED_MODELS,
  registeredIdsFor,
  type ModelProvider,
  type RegisteredModel,
} from "@/config/model-registry";

export const MODEL_ENDPOINTS: Record<ModelProvider, { url: string; keyEnv: string }> = {
  groq: { url: "https://api.groq.com/openai/v1/models", keyEnv: "GROQ_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/models", keyEnv: "OPENROUTER_API_KEY" },
};

/** Reads one provider's catalogue. `null` means WE COULD NOT LOOK (no key,
 *  network failure, non-200, unparseable body) — deliberately not an empty
 *  set. Treating a failed fetch as "the catalogue is empty" would report every
 *  pinned model as dead and invent an outage out of our own network blip. */
export type CatalogReader = (provider: ModelProvider) => Promise<Set<string> | null>;

export const fetchCatalog: CatalogReader = async (provider) => {
  const { url, keyEnv } = MODEL_ENDPOINTS[provider];
  const key = process.env[keyEnv];
  if (!key) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body?.data)) return null;
    const ids = new Set(body.data.map((m) => String(m?.id)).filter(Boolean));
    // A syntactically valid but EMPTY catalogue is likelier to be a provider
    // glitch than the simultaneous death of every model, and treating it as
    // truth would raise a maximally alarming false alert. Refuse to judge.
    return ids.size === 0 ? null : ids;
  } catch {
    return null;
  }
};

/**
 * Is the model callable WITH THE REQUEST THIS APP SENDS?
 *
 * The catalogue check above answers "does the id still exist", and on
 * 2026-08-27 that was not enough. `qwen/qwen3.6-27b` was present in the
 * catalogue the whole time every call to it 400'd: Groq had narrowed the
 * `reasoning_effort` values that model accepts to `none`/`default`, and this
 * app sends `low`. The frontier judge panel's second lineage had been
 * abstaining, which left proposals judged only by gpt-oss-120b while the
 * generator is gpt-oss-20b — same lineage marking its own homework — and the
 * rot check reported `rotted: 0` throughout.
 *
 * Existence is not callability. So this posts a ONE-TOKEN completion built from
 * `supportsReasoningEffort`, the same predicate the real call path uses, because
 * a probe that decided independently which models get the parameter would be a
 * second source of truth and would pass while production 400s.
 *
 * Cost: a rejected request is refused before inference, and an accepted one is
 * capped at a single token — so this stays affordable against the 100k/day
 * org-wide free tier that the zero-token design of the catalogue check exists
 * to protect.
 */
export type CallVerdict = "accepted" | "rejected" | "unknown";
export type CallProbe = (
  model: RegisteredModel,
) => Promise<{ verdict: CallVerdict; error?: string }>;

export type ProviderCheck = {
  provider: ModelProvider;
  /** False = catalogue unreadable; `missing` is then meaningless and empty. */
  reachable: boolean;
  presentIds: string[];
  missing: RegisteredModel[];
  uncheckedIds: string[];
};

export type ModelCheckReport = {
  providers: ProviderCheck[];
  /** Pins confirmed absent from a catalogue we successfully read. */
  missing: RegisteredModel[];
  /** Pins we could not judge either way. Never a pass, never a failure. */
  uncheckedIds: string[];
  presentCount: number;
  /** Present in the catalogue, but the provider REFUSES the request this app
   *  builds for it. A dead feature that every existence check calls healthy. */
  rejected: Array<{ model: RegisteredModel; error: string }>;
};

/**
 * `probe` defaults to null — OFF. A probe sends a real completion, so no
 * scheduled caller may pass one: the box's keys are free tiers shared by every
 * app, and a timer may not spend them (2026-09-25 — the cron used to pass a
 * one-token probe per pinned model, every day, while its header said "zero
 * tokens"). The seam stays for the unit tests, which pass fakes. That keeps the unit tests
 * network-free by default: a check that silently started calling a paid API
 * from the test suite would be a worse bug than the one it detects.
 */
export async function checkRegisteredModels(
  read: CatalogReader = fetchCatalog,
  probe: CallProbe | null = null,
): Promise<ModelCheckReport> {
  const providers = [...new Set(REGISTERED_MODELS.map((m) => m.provider))];
  const results: ProviderCheck[] = [];

  for (const provider of providers) {
    const live = await read(provider);
    const ids = registeredIdsFor(provider);

    if (!live) {
      results.push({ provider, reachable: false, presentIds: [], missing: [], uncheckedIds: ids });
      continue;
    }

    const presentIds = ids.filter((id) => live.has(id));
    const deadIds = ids.filter((id) => !live.has(id));
    const missing = REGISTERED_MODELS.filter(
      (m) => m.provider === provider && deadIds.includes(m.id),
    );
    results.push({ provider, reachable: true, presentIds, missing, uncheckedIds: [] });
  }

  // Probe only ids we CONFIRMED exist and that are chat models. Probing one we
  // already know is missing would report the same casualty twice under two
  // names, and probing a transcription id against /chat/completions would 400
  // for a reason unrelated to the fault being looked for.
  const presentIds = new Set(results.flatMap((r) => r.presentIds));
  const rejected: ModelCheckReport["rejected"] = [];
  if (probe) {
    const seen = new Set<string>();
    for (const model of REGISTERED_MODELS) {
      if (model.kind !== "chat" || !presentIds.has(model.id) || seen.has(model.id)) continue;
      seen.add(model.id);
      const { verdict, error } = await probe(model);
      if (verdict === "rejected") rejected.push({ model, error: error ?? "" });
    }
  }

  return {
    providers: results,
    missing: results.flatMap((r) => r.missing),
    uncheckedIds: results.flatMap((r) => r.uncheckedIds),
    presentCount: results.reduce((n, r) => n + r.presentIds.length, 0),
    rejected,
  };
}

/** One-line-per-casualty text for an alert body: the id, and what it breaks.
 *  Refusals are listed alongside removals because the consequence is identical
 *  — the feature is dead — and only the remedy differs (repin vs fix the
 *  request). The provider's own message is included: it says which parameter it
 *  objected to, which is the whole fix. */
export function describeRot(report: ModelCheckReport): string {
  return [
    ...report.missing.map(
      (m) => `${m.provider}/${m.id} — GONE from the catalogue. Breaks: ${m.usedFor}`,
    ),
    ...report.rejected.map(
      (r) =>
        `${r.model.provider}/${r.model.id} — present but REFUSES our request: ${r.error}\n    Breaks: ${r.model.usedFor}`,
    ),
  ].join("\n");
}
