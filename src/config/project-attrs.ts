/**
 * Canonical project attribute keys — SSOT for every list that enumerates,
 * groups, or filters project attrs (context editor groups, profile-apply
 * key list, dispatch-context driving fields, attention signals) and for
 * call sites that pass a key string to the attrs API.
 *
 * Direct typed property reads (`attrs.next_step`) are fine and need not go
 * through this object — it exists to kill *string drift across lists*, not
 * property access.
 */
export const PROJECT_ATTR = {
  // Context brief (agent-facing)
  MISSION: "mission",
  VISION: "vision",
  CUSTOMERS: "customers",
  PROBLEM: "problem",
  SOLUTION: "solution",
  STACK: "stack",
  ARCHITECTURE: "architecture",
  CONVENTIONS: "conventions",
  // Distribution & go-to-market (agent-facing — rendered into dispatch
  // context like mission/solution, deliberately NOT market-lens: agents must
  // see how the project reaches people and gets paid)
  DISTRIBUTION: "distribution",
  GTM: "gtm",
  // Workflow / metadata
  STATUS: "status",
  MATURITY: "maturity",
  NEXT_STEP: "next_step",
  DEFINITION_OF_DONE: "definition_of_done",
  GOAL_MAX_TURNS: "goal_max_turns",
  DESCRIPTION: "description",
  OWNER: "owner",
  PRODUCTION_URL: "production_url",
  URL: "url",
  REPO: "repo",
  GITHUB_REPO: "github_repo",
  // Attention signals (flag a project as needing attention)
  SECURITY_VULNERABILITY: "security_vulnerability",
  BROKEN_FEATURES: "broken_features",
  DEPLOYMENT_ISSUE: "deployment_issue",
  // Business plan
  BUSINESS_PLAN: "business_plan",
  BUSINESS_ACTIONS: "business_actions",
  BUSINESS_PLAN_UPDATED_AT: "business_plan_updated_at",
  // Market lens (human-facing profile fields)
  CURRENT_ALTERNATIVES: "current_alternatives",
  COMPETITORS: "competitors",
  COMPLEMENTS_SUBSTITUTES: "complements_substitutes",
  PARTNERSHIPS: "partnerships",
  POTENTIAL_CUSTOMERS: "potential_customers",
  EXPANSION_IDEAS: "expansion_ideas",
} as const;

export type ProjectAttrKey = (typeof PROJECT_ATTR)[keyof typeof PROJECT_ATTR];

/**
 * The attributes a project PUBLISHES — the outward-facing half of its identity,
 * served on /api/fleet/map to anyone.
 *
 * This is an allowlist and must stay one. The table above is open (the UI lets
 * anyone add a key) and it already holds `business_plan`, `competitors`,
 * `partnerships` and `security_vulnerability` — a denylist, or "publish every
 * attr", puts the next key someone types on the public internet by default.
 * These four are public because all four are the pitch a reader is owed:
 * what hurts, what we built, why, and where it goes.
 *
 * Roadmap and changelog are NOT here — they are rows, not attributes (`goals`
 * and `user_projects.dev_log`), and each publishes a deliberately narrower
 * projection than it stores. See `publicRoadmap`/`publicChangelog` in
 * `lib/register/map.ts`.
 */
export const PUBLIC_IDENTITY_ATTRS = [
  PROJECT_ATTR.PROBLEM,
  PROJECT_ATTR.SOLUTION,
  PROJECT_ATTR.MISSION,
  PROJECT_ATTR.VISION,
] as const satisfies readonly ProjectAttrKey[];

export type PublicIdentityAttr = (typeof PUBLIC_IDENTITY_ATTRS)[number];

/** Acronyms and product names that must not be sentence-cased into mush. */
const ATTR_WORD_OVERRIDES: Record<string, string> = {
  url: "URL",
  urls: "URLs",
  api: "API",
  ci: "CI",
  cd: "CD",
  gtm: "GTM",
  seo: "SEO",
  ui: "UI",
  ux: "UX",
  id: "ID",
  db: "DB",
  btc: "BTC",
  orangecat: "OrangeCat",
  github: "GitHub",
  ai: "AI",
};

/**
 * `production_url` → "Production URL". The uncurated attributes rendered as
 * `key.replace(/_/g, " ")`, so the profile printed raw snake_case database
 * keys at the reader ("production url", "gtm") — a data dump wearing a label's
 * clothes. Unknown keys still degrade gracefully to sentence case.
 */
export function humanizeAttrKey(key: string): string {
  const words = key.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((w, i) => {
      const override = ATTR_WORD_OVERRIDES[w.toLowerCase()];
      if (override) return override;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
    })
    .join(" ");
}

/* ────────────────────────────────────────────────────────────────────────────
 * The field registry.
 *
 * WHY THIS EXISTS: five separate lists decided what a project field is and
 * does — the context-editor groups, the agent dossier profile, the fallback
 * DRIVING_FIELDS, the AI profile-apply keys, and the public allowlist. Adding
 * one field meant editing five places, and they had already drifted: the
 * dossier carries `status`, DRIVING_FIELDS does not; the dossier says
 * "Next owner step" where DRIVING_FIELDS says "Next step (owner's …)". Those
 * lists are now DERIVED from this one, so a field is described exactly once.
 *
 * The divergences are preserved deliberately (see `inAgentDossier` /
 * `inDrivingFields`) rather than quietly reconciled: changing them changes
 * what every agent reads, which is a product decision and belongs in its own
 * change, not inside a refactor.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Editor groups, in render order. `build` spans both columns. */
export const PROJECT_FIELD_GROUPS = [
  { id: "purpose", title: "Purpose" },
  { id: "product", title: "Product" },
  { id: "reach", title: "Reach" },
  { id: "build", title: "Build contract" },
] as const;

export type ProjectFieldGroupId = (typeof PROJECT_FIELD_GROUPS)[number]["id"];

export type ProjectField = {
  key: ProjectAttrKey;
  /** Label in the context editor — and the default label everywhere else. */
  label: string;
  /** Editor hint. Only meaningful for fields that have an editor `group`. */
  placeholder?: string;
  /** Editor group, or null when no free-form context row renders it. */
  group: ProjectFieldGroupId | null;
  /**
   * True when a dedicated UI owns this attr, so the context editor must not
   * list it under "Additional context". Market-lens fields are deliberately
   * NOT hidden: they have no editor group and still fall through to that
   * block, which is how they render today.
   */
  editorHidden: boolean;
  /** Label in the agent dossier's Profile block. Defaults to `label`. */
  dossierLabel?: string;
  /**
   * Label in the fallback dispatch context. The parentheticals tell the model
   * how to read the field, so they are part of the prompt, not prose.
   */
  drivingLabel?: string;
  /** Appears in the dossier Profile block (the primary agent path). */
  inAgentDossier: boolean;
  /** Appears in DRIVING_FIELDS (used only when a project has no dossier). */
  inDrivingFields: boolean;
  /** Written by the AI profile extraction in lib/project-brief.ts. */
  aiFill: boolean;
};

/** Attrs a dedicated UI owns end-to-end: no context row, never a profile line. */
const UI_OWNED_ATTRS = [
  [PROJECT_ATTR.MATURITY, "Maturity"],
  [PROJECT_ATTR.GOAL_MAX_TURNS, "Goal max turns"],
  [PROJECT_ATTR.DESCRIPTION, "Description"],
  [PROJECT_ATTR.OWNER, "Owner"],
  [PROJECT_ATTR.PRODUCTION_URL, "Production URL"],
  [PROJECT_ATTR.URL, "URL"],
  [PROJECT_ATTR.REPO, "Repo"],
  [PROJECT_ATTR.GITHUB_REPO, "GitHub repo"],
  [PROJECT_ATTR.SECURITY_VULNERABILITY, "Security risk"],
  [PROJECT_ATTR.BROKEN_FEATURES, "Broken features"],
  [PROJECT_ATTR.DEPLOYMENT_ISSUE, "Deploy issue"],
  [PROJECT_ATTR.BUSINESS_PLAN, "Business plan"],
  [PROJECT_ATTR.BUSINESS_ACTIONS, "Business actions"],
  [PROJECT_ATTR.BUSINESS_PLAN_UPDATED_AT, "Business plan updated at"],
] as const satisfies ReadonlyArray<readonly [ProjectAttrKey, string]>;

/** Market lens: human-facing. Never sent to agents — the prompt stays focused
 *  and cheap. No editor group and NOT editorHidden, so they surface under
 *  "Additional context", exactly as they do today. */
const MARKET_LENS_ATTRS = [
  [PROJECT_ATTR.CURRENT_ALTERNATIVES, "Current alternatives"],
  [PROJECT_ATTR.COMPETITORS, "Competitors"],
  [PROJECT_ATTR.COMPLEMENTS_SUBSTITUTES, "Complements and substitutes"],
  [PROJECT_ATTR.PARTNERSHIPS, "Partnerships"],
  [PROJECT_ATTR.POTENTIAL_CUSTOMERS, "Potential customers"],
  [PROJECT_ATTR.EXPANSION_IDEAS, "Expansion ideas"],
] as const satisfies ReadonlyArray<readonly [ProjectAttrKey, string]>;

export const PROJECT_FIELDS: readonly ProjectField[] = [
  {
    key: PROJECT_ATTR.MISSION,
    label: "Mission",
    placeholder: "Why this project exists now",
    group: "purpose",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.VISION,
    label: "Vision",
    placeholder: "The future this project should create",
    group: "purpose",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.CUSTOMERS,
    label: "People served",
    placeholder: "Who uses it and what they need",
    group: "purpose",
    editorHidden: false,
    // Agents have always read this as "Customers"; only the editor renames it.
    dossierLabel: "Customers",
    drivingLabel: "Customers",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.PROBLEM,
    label: "Problem",
    placeholder: "The concrete problem worth solving",
    group: "product",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.SOLUTION,
    label: "Solution",
    placeholder: "How this project solves the problem",
    group: "product",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.DISTRIBUTION,
    label: "Distribution",
    placeholder: "Channels that exist today — RSS, newsletter, social queue, OG cards",
    group: "reach",
    editorHidden: false,
    drivingLabel: "Distribution (channels this project reaches people through today)",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.GTM,
    label: "Go-to-market",
    placeholder: "ICP, path to first paying customer, monetization state",
    group: "reach",
    editorHidden: false,
    drivingLabel: "Go-to-market (ICP, path to first paying customer, monetization state)",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  // Workflow field: a dedicated UI owns it, but the dossier still reads it.
  // Ordered here because THIS ARRAY'S ORDER IS THE DOSSIER PROFILE'S ORDER —
  // the primary path every dispatch with a dossier takes. The derived
  // DRIVING_FIELDS fallback inherits it, which moves "Next step" later in that
  // one prompt; the two paths listing the same fields in different orders was
  // the drift this registry exists to end.
  {
    key: PROJECT_ATTR.STATUS,
    label: "Status",
    group: null,
    editorHidden: true,
    // In the dossier but NOT in DRIVING_FIELDS — a real, preserved divergence,
    // not an oversight of this refactor.
    inAgentDossier: true,
    inDrivingFields: false,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.STACK,
    label: "Stack",
    placeholder: "Languages, frameworks, and infrastructure",
    group: "build",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.ARCHITECTURE,
    label: "Architecture",
    placeholder: "Main modules, stores, and integrations",
    group: "build",
    editorHidden: false,
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.CONVENTIONS,
    label: "Conventions",
    placeholder: "Patterns and rules every agent must follow",
    group: "build",
    editorHidden: false,
    drivingLabel: "Conventions (how this project is built — follow these)",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.DEFINITION_OF_DONE,
    label: "Definition of done",
    group: null,
    editorHidden: true,
    drivingLabel: "Definition of done (a change isn't finished until this holds)",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  {
    key: PROJECT_ATTR.NEXT_STEP,
    label: "Next step",
    group: null,
    editorHidden: true,
    dossierLabel: "Next owner step",
    drivingLabel: "Next step (owner's highest-priority action right now)",
    inAgentDossier: true,
    inDrivingFields: true,
    aiFill: true,
  },
  ...MARKET_LENS_ATTRS.map(([key, label]): ProjectField => ({
    key,
    label,
    group: null,
    editorHidden: false,
    inAgentDossier: false,
    inDrivingFields: false,
    aiFill: true,
  })),
  ...UI_OWNED_ATTRS.map(([key, label]): ProjectField => ({
    key,
    label,
    group: null,
    editorHidden: true,
    inAgentDossier: false,
    inDrivingFields: false,
    aiFill: false,
  })),
];

/** Fields the context editor renders as free-form rows, grouped for display. */
export const PROJECT_CONTEXT_GROUPS = PROJECT_FIELD_GROUPS.map((group) => ({
  ...group,
  fields: PROJECT_FIELDS.filter((field) => field.group === group.id),
}));

/**
 * `[key, label]` pairs for the FALLBACK dispatch context, re-exported by
 * db/queries/project-context as DRIVING_FIELDS. It lives here, with the rest of
 * the registry, because it is pure config — keeping it in a queries module made
 * it unreachable from the env-independent unit suite, so the text every
 * fallback prompt carries had no test.
 */
export const PROJECT_DRIVING_FIELDS: ReadonlyArray<readonly [string, string]> =
  PROJECT_FIELDS.filter((field) => field.inDrivingFields).map(
    (field) => [field.key, field.drivingLabel ?? field.label] as const,
  );

/** Attrs a dedicated UI owns — never listed under "Additional context". */
export const PROJECT_EDITOR_HIDDEN_KEYS: ReadonlySet<string> = new Set(
  PROJECT_FIELDS.filter((f) => f.editorHidden).map((f) => f.key),
);

/** Keys the AI profile extraction may write. */
export const PROJECT_AI_FILL_KEYS: readonly ProjectAttrKey[] = PROJECT_FIELDS.filter(
  (f) => f.aiFill,
).map((f) => f.key);

export const projectFieldByKey: ReadonlyMap<string, ProjectField> = new Map(
  PROJECT_FIELDS.map((f) => [f.key as string, f]),
);
