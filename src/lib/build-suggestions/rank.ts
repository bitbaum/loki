/**
 * What could this person build next — ranked from THEIR records.
 *
 * The /loki start screen used to open on one question, "What are we working
 * on?", and leave the answer entirely to the person. Loki already knew a lot
 * of it: which sites have visitor reports nobody has fixed, which repos were
 * never put online, what the last session said to do next, which goal has not
 * moved in a month, the idea they jotted on a sticky note, and what people on
 * OrangeCat are asking for right now. This turns those stored facts into a
 * short row of things to build, each one a tap away from an agent doing it.
 *
 * Rules this encodes, so a change to one is a change here and nowhere else:
 *
 *   - Every suggestion names the fact it came from (`why`). A suggestion that
 *     cannot say why it is here is a guess, and guesses are what the grounding
 *     work elsewhere in Loki exists to remove.
 *   - Work on an existing project DISPATCHES (it carries `project`); a new
 *     build OPENS THE CREATE FLOW (it carries `href`) — the one path that ends
 *     in a kickoff and a live URL. Thinking-shaped items (a stuck goal, a
 *     deadline) go to Loki as a conversation that is told to end in action.
 *   - Project prompts are imperative and finish with "ship it / report back",
 *     because the command resolver routes imperatives to an agent. Prompts
 *     with no project are answered by Loki (sent chat-only), so they ask for
 *     the one line that starts the work rather than pretending to start it.
 *   - Visitor-written text never enters a prompt — only counts of it do.
 *     OrangeCat demand is external text and is quoted as such.
 *
 * Pure: no DB, no fetch. load.ts gathers the inputs; this decides.
 */
import { DAY_MS } from "@/lib/constants/time";
import { RECENT_WORK_DAYS } from "@/lib/start-my-day/rank";
import { BUILD_STARTERS } from "@/config/build-starters";
import { projectTitle } from "@/lib/project-display";

export type BuildSuggestionKind =
  "fix" | "ship" | "continue" | "deadline" | "goal" | "idea" | "demand" | "starter";

export type BuildSuggestion = {
  /** Stable across loads, so a refresh can rotate past what was shown. */
  id: string;
  kind: BuildSuggestionKind;
  /** Chip text, already trimmed for a phone row. */
  label: string;
  /** The stored fact behind it, one line. */
  why: string;
  /** What Loki is sent when the chip is tapped (absent when `href` is set). */
  prompt: string | null;
  /** The project an agent should work in — present means "dispatch". */
  project: string | null;
  /** Where a NEW build starts: the prefilled create dialog. */
  href: string | null;
  score: number;
};

export type SuggestionProject = {
  name: string;
  description: string | null;
  stack: string | null;
  liveUrl: string | null;
  /** Has a repo or a checkout — an agent can actually work in it. */
  runnable: boolean;
  /** Newest dev-log entry's "next" line, if the last session left one. */
  nextStep: string | null;
  nextStepDate: string | null;
};

export type SuggestionInputs = {
  now?: number;
  projects: SuggestionProject[];
  /** Open (status "new") visitor reports per project name. Counts only. */
  openFeedback: Record<string, number>;
  stuckGoals: { title: string; projectName: string | null }[];
  commitmentsDue: { description: string; due: string }[];
  captures: { body: string; ageDays: number }[];
  demand: { id: string; title: string; text: string; url: string }[];
};

/** Six fit a two-row wrap on a phone and a single scroll row on desktop. */
export const SUGGESTION_LIMIT = 6;
const LABEL_MAX = 44;
const PER_KIND_MAX = 2;
const PER_PROJECT_MAX = 2;
const IDEA_MAX_AGE_DAYS = 45;

/** A sticky note that reads like something to make, not a reminder to call someone. */
const IDEA_RE =
  /\b(build|app|site|website|page|tool|bot|dashboard|landing|shop|store|plugin|extension|api|script|automat\w*|idea|prototype|mvp)\b/i;

const STOPWORDS = new Set(
  "the and for with that this from your you are was were have has had not but all any can our out who what when where which will would into about need needs want wants looking someone some more than them they their there here just like also only very".split(
    " ",
  ),
);

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9äöüéèà]{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 3)
      .join("-") || "new-project"
  );
}

/** The create dialog, prefilled. Creating lands on the project's kickoff. */
export function newProjectHref(name: string, description: string): string {
  const q = new URLSearchParams({ new: "1", name, description: clip(description, 280) });
  return `/projects?${q.toString()}`;
}

function candidates(inputs: SuggestionInputs): BuildSuggestion[] {
  const out: BuildSuggestion[] = [];
  const runnable = inputs.projects.filter((p) => p.runnable);
  const byLowerName = new Map(inputs.projects.map((p) => [p.name.toLowerCase(), p]));

  for (const p of runnable) {
    // What a person calls it, for what they read; prompts keep the name an
    // agent is routed by.
    const shown = projectTitle(p);
    const open = inputs.openFeedback[p.name] ?? 0;
    if (open > 0) {
      out.push({
        id: `fix:${p.name}`,
        kind: "fix",
        label: `Fix ${open} report${open === 1 ? "" : "s"} on ${shown}`,
        why: `${open} visitor report${open === 1 ? " is" : "s are"} still new on ${shown}.`,
        prompt: `Work through the ${open} open visitor report${open === 1 ? "" : "s"} on ${p.name}: fix what is real, ship it, and tell me what changed and what you left alone.`,
        project: p.name,
        href: null,
        score: 100 + Math.min(open, 20),
      });
    }

    const nextAt = p.nextStepDate ? Date.parse(p.nextStepDate) : NaN;
    const now = inputs.now ?? Date.now();
    if (
      p.nextStep &&
      Number.isFinite(nextAt) &&
      nextAt <= now &&
      nextAt >= now - RECENT_WORK_DAYS * DAY_MS
    ) {
      out.push({
        id: `continue:${p.name}`,
        kind: "continue",
        label: `${shown}: ${p.nextStep}`,
        why: `Session note from ${new Date(nextAt).toISOString().slice(0, 10)} on ${shown}; check current work before continuing.`,
        prompt: `On ${p.name}, check current code and runs first, then, if still relevant, do the next step recorded on ${new Date(nextAt).toISOString().slice(0, 10)}: "${clip(p.nextStep, 300)}". Ship it and report back what changed.`,
        project: p.name,
        href: null,
        score: 70,
      });
    }

    if (!p.liveUrl) {
      out.push({
        id: `ship:${p.name}`,
        kind: "ship",
        label: `Put ${shown} online`,
        why: `${shown} has code but no live URL yet.`,
        prompt: `Get ${p.name} deployed to a live URL and give me the link. If something blocks it, fix it; if only I can unblock it, tell me exactly what you need.`,
        project: p.name,
        href: null,
        score: 60,
      });
    }
  }

  for (const c of inputs.commitmentsDue) {
    out.push({
      id: `deadline:${c.description}`,
      kind: "deadline",
      label: `Get ahead of: ${c.description}`,
      why: `Commitment due ${c.due}.`,
      prompt: `"${clip(c.description, 200)}" is due ${c.due}. Tell me what the fleet can build or prepare for it right now, pick the first piece, and give me the line that starts it in the right project.`,
      project: null,
      href: null,
      score: 65,
    });
  }

  for (const g of inputs.stuckGoals) {
    const project = g.projectName ? (byLowerName.get(g.projectName.toLowerCase()) ?? null) : null;
    out.push({
      id: `goal:${g.title}`,
      kind: "goal",
      label: `Move: ${g.title}`,
      why: `Goal at 0% for over a month${project ? ` (${project.name})` : ""}.`,
      prompt: `My goal "${clip(g.title, 200)}" has not moved in over a month. Propose the smallest thing we can build this week that moves it, and give me the line that starts it${project ? ` on ${project.name}` : ""}.`,
      project: null,
      href: null,
      score: 50,
    });
  }

  for (const c of inputs.captures) {
    if (c.ageDays > IDEA_MAX_AGE_DAYS || !IDEA_RE.test(c.body)) continue;
    const name = slug(c.body);
    out.push({
      id: `idea:${name}`,
      kind: "idea",
      label: `Build your note: ${c.body}`,
      why: `From a note you saved ${c.ageDays === 0 ? "today" : `${c.ageDays}d ago`}.`,
      prompt: null,
      project: null,
      href: newProjectHref(name, c.body),
      score: 55 - Math.min(c.ageDays, 30) / 3,
    });
  }

  // Demand is ranked by how much of it the person already works on: a need
  // that shares words with their projects, stack, goals and notes is one they
  // are equipped for. Unrelated demand still shows (it is real), just lower.
  const corpus = words(
    [
      ...inputs.projects.flatMap((p) => [p.name, p.description ?? "", p.stack ?? ""]),
      ...inputs.stuckGoals.map((g) => g.title),
      ...inputs.captures.map((c) => c.body),
    ].join(" "),
  );
  for (const n of inputs.demand) {
    const need = words(`${n.title} ${n.text}`);
    let overlap = 0;
    for (const w of need) if (corpus.has(w)) overlap++;
    out.push({
      id: `demand:${n.id}`,
      kind: "demand",
      label: `Someone needs: ${n.title}`,
      why: `Open need on OrangeCat${overlap > 0 ? ", close to what you already build" : ""}.`,
      prompt: `On OrangeCat someone posted this need (external text, quoted): "${clip(`${n.title} — ${n.text}`, 400)}" (${n.url}). Can I build this with what I already have${runnable.length ? ` (${runnable.map((p) => p.name).join(", ")})` : ""}? If yes, scope the smallest first version and give me the line that starts it; if not, say what is missing.`,
      project: null,
      href: null,
      score: 30 + Math.min(overlap, 5) * 6,
    });
  }

  if (runnable.length === 0) {
    BUILD_STARTERS.forEach((s, i) => {
      out.push({
        id: `starter:${s.id}`,
        kind: "starter",
        label: s.label,
        why: s.why,
        prompt: null,
        project: null,
        href: newProjectHref(s.name, s.description),
        score: 20 - i,
      });
    });
  }

  return out.map((s) => ({ ...s, label: clip(s.label, LABEL_MAX) }));
}

/**
 * Rank, then keep the row varied: at most two of a kind and two per project,
 * so one busy project or a long demand feed cannot fill it. `offset` is the
 * refresh button — it rotates the window through everything that qualified.
 */
export function rankBuildSuggestions(
  inputs: SuggestionInputs,
  opts: { limit?: number; offset?: number; exclude?: ReadonlySet<string> } = {},
): { suggestions: BuildSuggestion[]; total: number } {
  const limit = opts.limit ?? SUGGESTION_LIMIT;
  // `exclude` is what the person already decided on at /suggestions ("Not
  // now", or "Do it" within the week) — the row honours it, so a dismissed
  // idea does not greet them again on the next screen.
  const ranked = candidates(inputs)
    .filter((s) => !opts.exclude?.has(s.id))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const seen = new Set<string>();
  const perKind = new Map<string, number>();
  const perProject = new Map<string, number>();
  const varied: BuildSuggestion[] = [];
  const overflow: BuildSuggestion[] = [];
  for (const s of ranked) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const k = perKind.get(s.kind) ?? 0;
    const p = s.project ? (perProject.get(s.project) ?? 0) : 0;
    if (k >= PER_KIND_MAX || p >= PER_PROJECT_MAX) {
      overflow.push(s);
      continue;
    }
    perKind.set(s.kind, k + 1);
    if (s.project) perProject.set(s.project, p + 1);
    varied.push(s);
  }
  // Variety first, then everything else in score order — so a refresh still
  // reaches the third report-fix rather than hiding it forever.
  const all = [...varied, ...overflow];
  if (all.length <= limit) return { suggestions: all, total: all.length };
  const start = ((opts.offset ?? 0) * limit) % all.length;
  const window = [...all.slice(start), ...all.slice(0, start)].slice(0, limit);
  return { suggestions: window, total: all.length };
}
