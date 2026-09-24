import { ECOSYSTEM } from "@/config/ecosystem";
import { publicProfilePath, type FleetMap, type FleetMapEntry } from "@/lib/register/map";

/**
 * The widget's Chat mode: a front desk that knows every project on the fleet
 * map and sends a visitor to the one that fits.
 *
 * It is a plain chat with two residents, the Cat and Loki, each answering as
 * itself: the Cat when the question is about earning or getting paid, Loki when
 * it is about getting work built, both when both have something to say. They
 * are the two agents that already know the whole studio — the Cat reads this
 * same map on OrangeCat, and Loki builds every project on it. A third
 * assistant with its own copy of the catalogue would drift from both.
 *
 * Everything here is pure: map in, strings out. The route does the I/O.
 */

/** A link the widget renders under an answer. */
export type ConciergeLink = { label: string; url: string };

export type ConciergeTurn = { role: "user" | "assistant"; content: string };

/** Who is talking in the chat. Null when neither agent said it (the keyword fallback). */
export type ConciergeSpeaker = "cat" | "loki" | null;
export type ConciergeMessage = { speaker: ConciergeSpeaker; text: string };

/**
 * The studio's own doors — the things a visitor can DO besides open a product.
 * Not on the map because they are not projects, and needed because "can you
 * build this for me?" is the question the map cannot route.
 */
export const STUDIO_DOORS: ReadonlyArray<{
  label: string;
  url: string;
  when: string;
  keys: string[];
}> = [
  {
    label: "Join the studio waitlist",
    url: "https://bitbaum.orangecat.ch/hire/#waitlist",
    when: "they want something built for them, want to hire the studio, or ask about rates",
    keys: ["waitlist", "hire", "rates"],
  },
  {
    label: "Browse the shared packages",
    url: "https://bitbaum.orangecat.ch/packages/",
    when: "they are a developer looking for reusable code (AI calls, email, rate limiting, blogs)",
    keys: ["package", "packages", "npm"],
  },
  {
    label: "See all projects",
    url: "https://bitbaum.orangecat.ch/work/",
    when: "they want the whole catalogue",
    keys: ["all projects", "catalogue", "catalog"],
  },
  {
    label: "Build with us",
    url: "https://bitbaum.orangecat.ch/#join",
    when: "they want to contribute code or build on the stack",
    keys: ["contribute", "contributor", "pull request"],
  },
];

/**
 * The public word for a project's state. apps.conf `live` means the process is
 * served, not that it is released, so it is said as beta — the same rule the
 * studio site follows. Owner-built-for projects are pilots: "client" is a
 * provisioning fact, not something to tell a stranger.
 */
export function stageWord(p: Pick<FleetMapEntry, "status" | "owner">): string {
  const base: Record<string, string> = {
    live: "running, in beta",
    demo: "a demo with sample data",
    validating: "being validated",
    prospect: "named but not built",
    unverified: "a concept",
    "not live": "in development, not publicly running",
  };
  const word = base[p.status] ?? p.status;
  return p.owner && p.owner !== "bitbaum" ? `${word}; a pilot built with ${p.owner}` : word;
}

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * A throwaway's name: what the generator stamps on dogfood and factory runs.
 * The SAME pattern as scripts/ci/check-no-experiment-litter.sh, which keeps
 * such names out of the committed register — the map is built from more than
 * that register, so one can still reach it. Kept equal by
 * scripts/test/widget-chat-concierge.ts.
 */
export const EXPERIMENT_NAME_RE =
  /(^(dogfood|coldstart|factory|probe|e2e|scratch|throwaway)-)|(-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[0-9]{2}(-[0-9]{3,4})?$)/i;

/**
 * Projects a visitor can be sent to. Retired ones are history and throwaways
 * were never doors. A project that is not running is included only once
 * someone has written what problem it solves and how: without that there is
 * nothing to route a need to, only a name to guess from.
 */
export function visibleProjects(map: FleetMap): FleetMapEntry[] {
  return map.projects.filter((p) => {
    if (p.status === "retired" || EXPERIMENT_NAME_RE.test(p.slug)) return false;
    if (p.status === "not live") return Boolean(p.identity.problem && p.identity.solution);
    return true;
  });
}

const PILLAR_TITLES: Record<string, string> = {
  orangecat: ECOSYSTEM.orangeCat.title,
  loki: ECOSYSTEM.loki.title,
  solon: ECOSYSTEM.solon.title,
};

/**
 * The name to show a stranger. The register falls back to the slug when no
 * display name was set, so the pillars arrive as "orangecat" — their titles
 * are SSOT in config/ecosystem.ts.
 */
export function displayName(p: Pick<FleetMapEntry, "slug" | "name">): string {
  return PILLAR_TITLES[p.slug] ?? p.name.trim();
}

/** Where to send someone for this project: the running product first, else its public profile. */
export function projectUrl(p: FleetMapEntry, appBase: string): string {
  return p.urls.live ?? `${appBase}${publicProfilePath(p.slug)}`;
}

/**
 * The facts the model answers from. One short block per project, fixed order,
 * with the problem included: "what is it" is rarely what a visitor asks — "I
 * have this problem" is, and matching that needs the problem.
 *
 * No URLs: the model is told not to write any, the links are attached from the
 * map afterwards, and every character here is paid for on a rationed free
 * tier. The whole block is budgeted (FACTS_BUDGET_CHARS) because a prompt the
 * vendors' per-minute limits refuse is an assistant that never answers.
 */
export const FACTS_BUDGET_CHARS = 9000;

export function renderConciergeFacts(map: FleetMap): string {
  const pillars = map.pillars
    .map((p) => `- ${PILLAR_TITLES[p.slug] ?? p.slug} (${p.layer}): ${p.role}`)
    .join("\n");
  const projects = visibleProjects(map)
    .map((p) =>
      [
        `* ${displayName(p)} — ${stageWord(p)}.`,
        p.what ? clip(p.what, 140) : null,
        p.identity.problem ? `Problem: ${clip(p.identity.problem, 150)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
  const doors = STUDIO_DOORS.map((d) => `- ${d.label}: when ${d.when}`).join("\n");
  const facts = `# The three pillars\n${pillars}\n\n# Projects\n${projects}\n\n# Studio doors\n${doors}`;
  return facts.length > FACTS_BUDGET_CHARS ? `${facts.slice(0, FACTS_BUDGET_CHARS - 1)}…` : facts;
}

export function conciergeSystemPrompt(
  facts: string,
  page: { url?: string; title?: string },
): string {
  return [
    "This is the chat on the website of bitbaum, an AI-native product studio in Zürich. Two agents live in it and you write for both:",
    "- Cat: OrangeCat's AI economic agent. It speaks when the visitor wants to earn, sell, get paid, fund or back something, settled in Bitcoin.",
    "- Loki: the execution layer that directs a fleet of AI agents and builds and deploys every project below. It speaks when the visitor wants something built, run, fixed or automated, or asks what exists and where.",
    "Between them they know every project the studio has. Whoever the question belongs to answers. If both have something genuinely useful, both answer — Cat first when money leads, Loki first otherwise. Never both just to be polite.",
    "Format: every message starts on a new line with 'Cat:' or 'Loki:'. Each speaks as itself in the first person ('I can…'); do not introduce yourselves as a pair or talk about 'the Cat and Loki'.",
    "The job: understand what the visitor needs, then send them to the ONE project or door that fits best — name it, say in a sentence why it fits, and tell them the next step. Offer a second option only if it is genuinely close.",
    "",
    "Rules:",
    "- Answer only from the facts below. If nothing fits, say so plainly and point to the waitlist or the full catalogue. Never invent a feature, price, date, number or project.",
    "- Say the stage honestly, using the words given (beta, pilot, in development, concept, not built). Never call anything released or finished, and never call anyone a client.",
    "- Do not promise payments, revenue shares or start dates.",
    "- Use each project's exact name so the visitor gets a link to it. Do not write URLs yourself; the links are attached for you.",
    "- Be warm and brief: two to five sentences in total, plain text, no markdown headings or tables. Reply in the visitor's language.",
    "- If they want to report a problem with this page, tell them to switch to the Report tab.",
    page.url ? `\nThe visitor is on: ${page.title ? `${page.title} — ` : ""}${page.url}` : "",
    "",
    facts,
  ].join("\n");
}

/** The conversation so far, as one prompt: the chain entry point takes a single prompt string. */
export function conciergePrompt(history: ConciergeTurn[], message: string): string {
  const past = history
    .slice(-12)
    .map((t) => (t.role === "user" ? `Visitor: ${t.content}` : t.content))
    .join("\n");
  return `${past ? `${past}\n` : ""}Visitor: ${message}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, term: string): boolean {
  if (term.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * Links for what an answer names, taken from the map rather than from the
 * model: a URL the model typed is a URL nobody checked. Ordered by where the
 * name first appears, so the first chip is the first recommendation.
 */
export function linksForReply(
  reply: string,
  map: FleetMap,
  appBase: string,
  max = 4,
): ConciergeLink[] {
  const found: Array<{ at: number; link: ConciergeLink }> = [];
  for (const p of visibleProjects(map)) {
    const terms = [displayName(p), p.name, p.slug].filter((t, i, a) => a.indexOf(t) === i);
    const hit = terms.find((t) => mentions(reply, t));
    if (!hit) continue;
    found.push({
      at: reply.toLowerCase().indexOf(hit.toLowerCase()),
      link: { label: displayName(p), url: projectUrl(p, appBase) },
    });
  }
  for (const d of STUDIO_DOORS) {
    const hit = d.keys.find((k) => mentions(reply, k));
    if (hit)
      found.push({ at: reply.toLowerCase().indexOf(hit), link: { label: d.label, url: d.url } });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.link)
    .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)))
    .slice(0, max);
}

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from have how i if in is it me my of on or so that the this to we what when where which who why with you your".split(
    " ",
  ),
);

/**
 * A crude English stem, so "voting" finds "vote" and "transparently" finds
 * "transparent". Crude is enough: this only ranks candidates when no model can
 * be asked, and a missed suffix costs a worse suggestion, not a wrong fact.
 */
export function stem(word: string): string {
  const cut = word.replace(/(ingly|edly|ations?|ions?|ing|ed|es|ly|s|e)$/, "");
  return cut.length >= 3 ? cut : word;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}

/**
 * The answer when no model can be asked — budget spent, every vendor down.
 * Still routes: scores each project by the visitor's words against its name,
 * purpose, problem and solution. A worse answer than the model's, and much
 * better than "try again later" to someone who only wanted to be pointed
 * somewhere.
 */
export function fallbackAnswer(
  message: string,
  map: FleetMap,
  appBase: string,
): { reply: string; links: ConciergeLink[] } {
  const wanted = new Set(words(message));
  // A pillar's role line says what it is FOR ("move value … Bitcoin settlement")
  // in the words a visitor uses; its product copy often does not.
  const pillarRole = new Map(map.pillars.map((pl) => [pl.slug, pl.role]));
  const scored = visibleProjects(map)
    .map((p) => {
      const name = new Set(words(`${p.name} ${p.slug}`));
      const body = words(
        [
          p.what,
          p.identity.problem,
          p.identity.solution,
          p.identity.mission,
          pillarRole.get(p.slug),
        ]
          .filter(Boolean)
          .join(" "),
      );
      let score = 0;
      for (const w of wanted) {
        if (name.has(w)) score += 5;
        score += Math.min(3, body.filter((b) => b === w).length);
      }
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      reply:
        "A full answer isn't available right now, and nothing in the catalogue matched those words. The full list of projects is one click away, or join the waitlist to have something built.",
      links: [
        { label: STUDIO_DOORS[2]!.label, url: STUDIO_DOORS[2]!.url },
        { label: STUDIO_DOORS[0]!.label, url: STUDIO_DOORS[0]!.url },
      ],
    };
  }
  const names = scored.map((s) => displayName(s.p));
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  return {
    reply: `A full answer isn't available right now, but going by your words, look at ${list}.`,
    links: scored.map((s) => ({ label: displayName(s.p), url: projectUrl(s.p, appBase) })),
  };
}

const SPEAKER_LINE = /^\s*(?:\*\*)?(cat|loki)(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i;

/**
 * Split a reply into who said what. A line starting "Cat:" or "Loki:" opens a
 * message; lines after it continue it. Text before any label — a model that
 * forgot the format — is kept, unattributed, rather than dropped or guessed.
 */
export function splitSpeakers(reply: string): ConciergeMessage[] {
  const out: ConciergeMessage[] = [];
  for (const line of reply.split("\n")) {
    const m = line.match(SPEAKER_LINE);
    if (m) {
      out.push({ speaker: m[1]!.toLowerCase() as "cat" | "loki", text: line.slice(m[0].length) });
    } else if (out.length) {
      out[out.length - 1]!.text += `\n${line}`;
    } else if (line.trim()) {
      out.push({ speaker: null, text: line });
    }
  }
  return out.map((m) => ({ ...m, text: m.text.trim() })).filter((m) => m.text.length > 0);
}
