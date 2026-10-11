/**
 * Loki's grounded context assembly — the seed every turn starts from.
 *
 * One builder, used by BOTH paths: the in-app tool loop (primary) and the
 * gateway fallback. Until 2026-09-11 there were two seeds. The loop's seed was
 * people + projects and nothing else; the richer one here — approvals, the
 * knowledge index, the economy feed, the cue-gated brief — was built only on
 * the fallback path, which normal turns never reached. So the approval queue
 * was "seeded so it survives losing the tool loop" (#262) on a path the tool
 * loop never took, and the primary path could see the queue only by calling a
 * tool it could not afford to call. One seed, one definition, both paths.
 *
 * What goes in is decided by the retrieval planner (plan.ts): the sources the
 * question is about, fetched in parallel, leading subject first. Facts are
 * typed records with declared fields and `<not recorded>` for gaps; computed
 * answers (the daily and fleet briefs) ride alongside as directives the model
 * may only phrase.
 *
 * Best-effort throughout: a source that throws contributes nothing rather
 * than failing the turn, and the contract adapts — fewer facts permit fewer
 * citations, and none instructs a refusal.
 */
import { assignFactIds, renderFacts, type Fact } from "@bitbaum/ai-kit/grounding";
import { type Directive } from "@bitbaum/ai-kit/grounding";
import { buildLokiContext } from "@/lib/agent/grounded-context";
import {
  alertFacts,
  buildSuggestionFacts,
  captureFacts,
  commitmentFacts,
  crewFacts,
  documentFacts,
  economyFacts,
  feedbackFacts,
  fleetMapFacts,
  fleetStatusFacts,
  goalFacts,
  habitFacts,
  humanTaskFacts,
  pendingApprovalFacts,
  peopleFacts,
  projectFacts,
  runFacts,
  sessionFacts,
} from "@/lib/agent/sources";
import { buildDailyBrief, buildFleetBrief } from "@/lib/agent/brief";
import {
  planRetrieval,
  sourceLimit,
  toolsForPlan,
  type RetrievalPlan,
  type SourceId,
} from "@/lib/agent/plan";

/** Window for commitments/events when they lead the turn. */
const COMMITMENT_DAYS = 14;

/** What one source contributed — surfaced to the operator as provenance. */
export type RetrievedSource = { source: SourceId; count: number };

export type Seed = {
  facts: Fact[];
  directives: Directive[];
  retrieved: RetrievedSource[];
  plan: RetrievalPlan;
  /** Tool names worth advertising — narrows what the model SEES, never what it may call. */
  advertiseTools: Set<string>;
};

/** Fetch one planned source. Every branch is best-effort. */
async function fetchSource(
  id: SourceId,
  userId: string,
  message: string,
  plan: RetrievalPlan,
): Promise<Fact[]> {
  const limit = sourceLimit(plan, id);
  if (limit <= 0) return [];
  switch (id) {
    case "feedback":
      return feedbackFacts(userId, { limit });
    case "runs":
      return runFacts(userId, { limit });
    case "sessions":
      return sessionFacts(userId).then((f) => f.slice(0, limit));
    case "alerts":
      return alertFacts(userId, limit);
    case "fleet_status":
      return fleetStatusFacts(userId);
    case "fleet_map":
      return fleetMapFacts();
    case "approvals":
      return pendingApprovalFacts(userId, limit);
    case "goals":
      return goalFacts(userId, limit);
    case "habits":
      return habitFacts(userId, limit);
    case "commitments":
      return commitmentFacts(userId, COMMITMENT_DAYS).then((f) => f.slice(0, limit));
    case "crew":
      return crewFacts(userId, limit);
    case "human_tasks":
      return humanTaskFacts(userId, limit);
    case "captures":
      return captureFacts(userId, limit);
    case "people":
      return peopleFacts(userId, message).then((f) => f.slice(0, limit));
    case "knowledge":
      return documentFacts(userId, message, limit);
    case "economy":
      return economyFacts(message, limit);
    case "builds":
      return buildSuggestionFacts(userId, limit);
    case "projects":
      // The message is passed so a project the operator NAMED is ranked to the
      // front before either slice. Without it the two slices below are a
      // lottery over ~30 projects, and the one being asked about loses.
      return projectFacts(userId, message).then((f) => f.slice(0, limit));
  }
}

/**
 * Assemble everything Loki is allowed to know this turn.
 *
 * Facts arrive in PLAN order — the subject first, background last — because
 * the loop head-slices when the prompt must shrink, and the tail is what goes.
 */
export async function buildSeed(
  userId: string,
  message: string,
  opts: { plan?: RetrievalPlan } = {},
): Promise<Seed> {
  const plan = opts.plan ?? planRetrieval(message);

  const [perSource, daily, fleet] = await Promise.all([
    Promise.all(
      plan.sources.map((id) => fetchSource(id, userId, message, plan).catch(() => [] as Fact[])),
    ),
    plan.brief ? buildDailyBrief(userId).catch(() => [] as Directive[]) : Promise.resolve([]),
    plan.fleetBrief
      ? buildFleetBrief(userId).catch(() => [] as Directive[])
      : Promise.resolve([] as Directive[]),
  ]);

  const retrieved: RetrievedSource[] = plan.sources.map((source, i) => ({
    source,
    count: perSource[i].length,
  }));
  const facts = assignFactIds(perSource.flat());
  return {
    facts,
    directives: [...fleet, ...daily],
    retrieved,
    plan,
    advertiseTools: toolsForPlan(plan),
  };
}

export type GroundedTurn = {
  /** The full block to prepend to the model's input. */
  context: string;
  /** Facts with ids assigned — the caller needs these to verify the answer. */
  facts: Fact[];
  /** Computed answers, kept so the verifier can admit them as evidence. */
  directives: Directive[];
  retrieved: RetrievedSource[];
};

/** The seed rendered as one prompt block — what the gateway path prepends. */
export async function buildGroundedTurn(userId: string, message: string): Promise<GroundedTurn> {
  const seed = await buildSeed(userId, message);
  return {
    facts: seed.facts,
    directives: seed.directives,
    retrieved: seed.retrieved,
    // Same amended contract the tool loop uses. The production refusal
    // ("An opinion or assessment is: Not in your data.") came through THIS
    // path, so grounding the two differently is how one gets fixed and the
    // other keeps the bug.
    context: buildLokiContext({
      facts: seed.facts,
      directives: seed.directives,
      renderedFacts: renderFacts(seed.facts),
    }),
  };
}

/**
 * Evidence strings the verifier may treat as legitimately known beyond the fact
 * set — the computed briefs, whose contents are true by construction but do
 * not live in any Fact.
 */
export function directiveEvidence(directives: Directive[]): string[] {
  return directives.flatMap((d) => [d.question, ...d.answer]);
}
