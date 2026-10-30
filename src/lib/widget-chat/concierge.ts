import { ECOSYSTEM } from "@/config/ecosystem";
import { publicProfilePath, type FleetMap, type FleetMapEntry } from "@/lib/register/map";
import { publicOwner } from "@/lib/register/build";
import type { StudioCommissionContract } from "@/lib/studio-commission";

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

/** A line that opens a message: "Cat:" / "Loki:", tolerating markdown bold. */
const SPEAKER_LINE = /^\s*(?:\*\*)?(cat|loki)(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i;

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
    label: "Become a builder",
    url: "https://bitbaum.orangecat.ch/builders/#join",
    when: "they are a builder who wants to build for customers under their own name, or ask about approved builders (once called partners)",
    keys: [
      "become a builder",
      "approved builder",
      "builder application",
      "partners",
      "become a partner",
      "partner programme",
      "partner program",
      "partner application",
    ],
  },
  {
    label: "Read the systems design pilot",
    url: "https://bitbaum.orangecat.ch/academy/",
    when: "they ask about the course, the capstone, the rubric or how builders qualify",
    keys: ["systems design pilot", "capstone", "rubric", "academy"],
  },
  {
    label: "Build with us",
    url: "https://bitbaum.orangecat.ch/#join",
    when: "they want to contribute code or build on the stack",
    keys: ["contribute", "contributor", "pull request"],
  },
  // A person, for what no product and no door covers yet. "Nothing matched"
  // was a dead end; this is the way forward from it. The public contact
  // address is SSOT in bitbaum's CLAUDE.md.
  {
    label: "Ask a person",
    url: "mailto:cato@orangecat.ch",
    when: "nothing here fits yet, the request is unusual, or they would rather talk to a human",
    keys: ["ask a person", "write to a person", "talk to a person", "cato@orangecat.ch"],
  },
  // Last on purpose: the tests address the doors above by index. The one door
  // that is Loki's own — a site or app of THEIR own, by whichever of the three
  // ways fits (themselves, a partner, the studio). "Can you build this for me?"
  // used to route only to the waitlist, which is at capacity.
  {
    label: "Build something of your own",
    url: new URL("/build", ECOSYSTEM.loki.siteUrl).href,
    when: "they want a site or app of their own, ask how to get one like this, or whether they could do it themselves",
    keys: [
      "my own site",
      "my own app",
      "something of my own",
      "build my own",
      "get this for my site",
      "do it myself",
      "sign up",
    ],
  },
];

/**
 * The public word for a project's state. apps.conf `live` means the process is
 * served, not that it is released, so it is said as beta — the same rule the
 * studio site follows. Owner-built-for projects are pilots: "client" is a
 * provisioning fact, not something to tell a stranger.
 */
export function stageWord(
  p: Pick<FleetMapEntry, "status" | "owner"> & { urls?: { live: string | null } },
): string {
  // A "prospect" with nothing served is a name; one with an address answering
  // is a first version. The visitor can open the second, so say so.
  if (p.status === "prospect" && !p.urls?.live) return "named but not built";
  const base: Record<string, string> = {
    live: "in beta",
    demo: "a demo with sample data",
    validating: "being validated",
    prospect: "named, with only an early version to look at",
    unverified: "a concept",
    "not live": "in development, not publicly running",
  };
  const word = base[p.status] ?? p.status;
  const partner = publicOwner(p.owner);
  return partner ? `${word}; a pilot built with ${partner}` : word;
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
 * A website job, not a product: a new version of somebody's existing site, or
 * a site inspired by one. Those are someone else's before they are ours to
 * show (lib/register/client-work.ts), and a job that predates that rule can
 * still reach the map unmarked — seen live 2026-10-17, when the chat offered
 * strangers "derhochhinhousepartyrenner-ch-refresh-68e1f…", described by its
 * own build instruction. Recognised by the two shapes such a job leaves: the
 * old `<host>-refresh-<32 hex>` name (lib/brief-project-name.ts) and the
 * first line of the build brief (lib/website-brief.ts) as its description.
 */
const WEBSITE_JOB_NAME_RE = /-(refresh|inspired)-[0-9a-f]{32}$/i;
const WEBSITE_JOB_WHAT_RE =
  /^\s*(develop a new version of this existing website|create a new, independent website inspired by)\b/i;
export function isWebsiteJob(p: Pick<FleetMapEntry, "slug" | "what">): boolean {
  return WEBSITE_JOB_NAME_RE.test(p.slug) || WEBSITE_JOB_WHAT_RE.test(p.what ?? "");
}

/**
 * Projects a visitor can be sent to. Retired ones are history and throwaways
 * were never doors. A project that is not running is included only once
 * someone has written what problem it solves and how: without that there is
 * nothing to route a need to, only a name to guess from.
 */
export function visibleProjects(map: FleetMap): FleetMapEntry[] {
  return map.projects.filter((p) => {
    if (p.status === "retired" || EXPERIMENT_NAME_RE.test(p.slug)) return false;
    if (isWebsiteJob(p)) return false;
    // Someone else's work is theirs to show: without recorded consent it is
    // not a door, whatever the rest of the row says. The public map already
    // drops these; the chat holds the same line in case a map ever does not.
    if (p.client && !p.client.consentedAt) return false;
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

/**
 * The approved-builder terms as the studio site states them on /builders/
 * (called partners until 2026-10-30). Not in
 * the published contract (commission.json carries the offer and the course,
 * not these rules), so it is stated once here, beside the doors that route to
 * it. Without it the chat told applicants on that page that no partner
 * programme existed.
 */
export const PARTNER_TERMS = [
  "Approved builders are independent people the studio approved on their shipped work (they used to be called partners). They work under their own name and agree their own scope and price.",
  "Customers contract with and pay the builder directly; the studio takes no cut. Loki, OrangeCat and Solon are optional tools.",
  "To apply: one message on /builders/ saying who you are, what you build and where your work can be seen opens a private application; no account is needed. A person at the studio decides on that work.",
  "The systems design course and its capstone exam are optional. They are there to learn from, and passing adds a credential to the builder's profile; they are never required for approval.",
  "An approved builder's profile appears in the public builder directory only with their consent, after review, and while their availability is current.",
];

/**
 * What the studio offers right now, from the contract the studio site
 * publishes (commission.json, read by getStudioCommission). Null — the site
 * unreachable — still states the partner terms, which do not depend on it.
 */
export function renderStudioFacts(studio: StudioCommissionContract | null): string {
  const lines = ["# The studio", ...PARTNER_TERMS.map((t) => `- ${t}`)];
  if (studio) {
    lines.push(`- Availability: ${studio.availability.line}`);
    lines.push(
      `- Engagement: ${studio.offer.name}, ${studio.offer.price}, ${studio.offer.shape}. ${clip(studio.offer.what, 220)}`,
    );
    if (studio.course) {
      const modules = studio.course.modules.map((m) => m.title).join("; ");
      lines.push(
        `- Course: ${studio.course.title}${studio.course.pilot ? " (a pilot: one lesson and the capstone rubric are published, more lessons are being developed; no fixed duration is stated)" : ""}. The capstone asks for working evidence on ${studio.course.modules.length} modules: ${modules}.`,
      );
    }
  }
  return lines.join("\n");
}

export function renderConciergeFacts(
  map: FleetMap,
  studio: StudioCommissionContract | null = null,
): string {
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
  // The studio and its doors go before the projects: the budget cuts from the
  // end, and losing a project line costs less than denying the studio exists.
  const facts = [
    `# The three pillars\n${pillars}`,
    renderStudioFacts(studio),
    `# Studio doors\n${doors}`,
    `# Projects\n${projects}`,
  ].join("\n\n");
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
    "When the fit is OrangeCat, the Cat recommends itself in the first person ('you can set that up with me on OrangeCat'); when it is Loki, Loki does the same ('sign up and I'll run agents on your code'). Neither talks about itself as 'OrangeCat is…' or 'Loki is…'.",
    "Prefer what the visitor can use themselves today. The studio waitlist is only for having the studio build something FOR them, and the studio is at capacity — never send someone there when a product fits.",
    "",
    "Who asks: often not a developer — a shop owner, a parent, someone curious. Use everyday words; say 'website', not 'repo' or 'deploy', unless they did. Every answer ends with ONE concrete next step they can take now.",
    "When the request is vague ('can you build something?', 'help me with research'), ask ONE short question about what they want to achieve — and in the same message name the likeliest fit, so they always have something to click.",
    "What bitbaum is, if asked: a studio in Zürich that builds AI-native products on shared open infrastructure, so that more than one person can build here. Its three pillars are below; the projects are what is being built on them.",
    "Wanting a website, shop or app of their own is Loki's to answer: 'Build something of your own' — they describe it in a few sentences and get a first version to look at, without writing code.",
    "",
    "Rules:",
    "- Answer only from the facts below. Never invent a feature, price, date, number or project.",
    "- If nothing fits, say so in one sentence, then give the closest real way forward: 'Build something of your own' when it could be built, 'Ask a person' otherwise. Never stop at 'nothing matched'.",
    "- Say the stage honestly, using the words given (beta, pilot, in development, concept, not built). Never call anything released or finished, and never call anyone a client.",
    "- Do not promise payments, revenue shares or start dates. You may state the builder terms and the published engagement price exactly as the facts give them.",
    "- A builder who wants to work here, build for customers, or asks about builders (or partners, the old word), the course or the capstone: Loki answers from '# The studio' and points to 'Become a builder' or 'Read the systems design pilot'. Never say the builder programme or the course does not exist.",
    "- Use each project's exact name so the visitor gets a link to it. Do not write URLs yourself; the links are attached for you.",
    "- Never tell a visitor to sign up, register, create an account or install anything: say 'open <project>'. The project's own page says what it needs, and most need nothing.",
    "- No product here gives medical, legal or financial advice, diagnoses, prescribes, or represents anyone. Say what it does — reads, explains, organises, drafts — and, when the visitor needs a decision, that a doctor, lawyer or adviser makes it.",
    "- Be warm and brief: two to five sentences in total, plain text with no markdown at all (no bold, headings, lists or tables). Reply in the visitor's language.",
    "- The answer is only what the visitor reads. Never write notes about these rules, a checklist of what you did, the stage word you used, whether you wrote URLs, or why one of you spoke first.",
    "- If they want to report a problem with this page, tell them to switch to the Report tab.",
    page.url ? `\nThe visitor is on: ${page.title ? `${page.title} — ` : ""}${page.url}` : "",
    onProjectPage(page.url)
      ? "- They are on one project's own page. A question like 'what does this do', 'is it free', 'how does it work' or 'can I use it' is about THAT project: answer it from that project's facts first, in one or two sentences, and name the project so it gets its link. Never answer a question about a project by asking what they want to do, and never send them to build something of their own when they asked about the project they are looking at. Nothing on this site is sold: every product is free to try at its stage."
      : "",
    "",
    facts,
  ].join("\n");
}

/** The conversation so far, as one prompt: the chain entry point takes a single prompt string. */
/** The studio site's per-project pages: /<slug>/, not one of its own sections. */
const SITE_SECTIONS = new Set([
  "work",
  "hire",
  "partners",
  "studio",
  "academy",
  "packages",
  "map",
  "roadmap",
  "changelog",
  "portal",
  "private",
]);
export function onProjectPage(url: string | undefined): boolean {
  if (!url) return false;
  const m = url.match(/^https?:\/\/bitbaum\.orangecat\.ch\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
  return Boolean(m && !SITE_SECTIONS.has(m[1]!.toLowerCase()));
}

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
  // Speaker labels are not mentions: "Loki: Heidi fits." recommends Heidi,
  // not Loki, and linking the label put the wrong chip first.
  reply = reply
    .split("\n")
    .map((line) => line.replace(SPEAKER_LINE, ""))
    .join("\n");
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
  // A door is named by its label too: the prompt tells the model to say
  // "Build something of your own", and a reply that did so used to get no
  // button at all (seen live 2026-10-17, the bakery question).
  const doorUrls = new Set<string>();
  for (const d of STUDIO_DOORS) {
    const hit = [d.label, ...d.keys].find((k) => mentions(reply, k));
    if (!hit) continue;
    doorUrls.add(d.url);
    found.push({
      at: reply.toLowerCase().indexOf(hit.toLowerCase()),
      link: { label: d.label, url: d.url },
    });
  }
  const seen = new Set<string>();
  const ordered = found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.link)
    .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
  // A door is the next step the answer asked for; projects merely named (the
  // pillars in "what is bitbaum?") must not push it off the end.
  const kept = ordered.slice(0, max);
  for (const door of ordered.slice(max).filter((l) => doorUrls.has(l.url))) {
    const drop = kept.map((l) => doorUrls.has(l.url)).lastIndexOf(false);
    if (drop < 0) break;
    kept.splice(drop, 1);
    kept.push(door);
  }
  return kept;
}

/**
 * Words that carry no need, in the two languages visitors write here. German
 * was missing, so "Kannst du mir helfen, eine Recherche zu machen?" was scored
 * on "kannst", "helfen" and "machen" and matched whatever said "help".
 */
const STOPWORDS = new Set(
  [
    "a an and are as at be but by can could do does for from get have help how i if in is it just like make me my need of on or please so some something that the this to want we what when where which who why with would you your",
    "aber auch auf aus bei bitte das dass dem den der des die du ein eine einem einen einer er es etwas für helfen hilfe ich ihr im in ist kann kannst können machen mein meine mich mir mit möchte nicht noch oder sie sind und von was wer wie will wir wo zu",
  ]
    .join(" ")
    .split(" "),
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

/** German or not, by its function words: enough to answer in the visitor's language. */
const GERMAN_HINT =
  /(^|[^\p{L}])(ich|und|nicht|kannst|können|möchte|eine?n?|für|bitte|mir|meine?|wie|helfen|machen|ist|du|sie|webseite|bäckerei)(?=$|[^\p{L}])/giu;
export function looksGerman(text: string): boolean {
  return (text.match(GERMAN_HINT) ?? []).length >= 2;
}

type Lang = "en" | "de";
type Said = Record<Lang, string>;

/** The doors the fallback names, by label — never by index, so reordering cannot misroute. */
function door(label: string): ConciergeLink {
  const d = STUDIO_DOORS.find((x) => x.label === label)!;
  return { label: d.label, url: d.url };
}

/**
 * What a visitor most often wants, recognised without a model. Each names the
 * way forward that exists today, in both languages. Checked before project
 * words, because "I want a website for my bakery" is a request to have
 * something BUILT — the one question project names cannot route.
 */
type Intent = { re: RegExp; reply: Said; doors: string[]; pillar?: string };
const INTENTS: Intent[] = [
  {
    re: /(^|[^\p{L}])(research|recherche|recherchieren|study|studie|forschung|forschen|analyse|analysis|analyze|investigate|find out|herausfinden)(?=$|[^\p{L}])/iu,
    doors: ["Ask a person", "Build something of your own"],
    reply: {
      en: "There is no ready-made research assistant here yet. For the research itself, write to a person and say what you want to find out; if you need a tool or a site for your research, Loki can build it with you.",
      de: "Einen fertigen Recherche-Assistenten gibt es hier noch nicht. Für die Recherche selbst schreib einer Person, was du herausfinden möchtest; brauchst du ein Werkzeug oder eine Webseite dafür, kann Loki es mit dir bauen.",
    },
  },
  {
    re: /(^|[^\p{L}])(website|websites|webseite|webseiten|web site|homepage|online-?shop|shop|landing ?page|app|apps|portfolio|blog|build|building|bauen|baue|baut|erstellen|erstelle)(?=$|[^\p{L}])/iu,
    doors: ["Build something of your own"],
    reply: {
      en: "Loki can build that with you. Describe it in a few sentences — what it is for and who visits — and you get a first version to look at, no code needed.",
      de: "Loki kann das mit dir bauen. Beschreibe es in ein paar Sätzen – wofür es ist und wer es besucht – und du bekommst eine erste Version zum Anschauen, ohne Programmieren.",
    },
  },
  {
    re: /(^|[^\p{L}])(sell|selling|earn|earning|get paid|pay|payment|payments|bitcoin|lightning|fund|funding|donate|donation|verkaufen|verkaufe|bezahlen|bezahlt|geld|zahlung|zahlungen|spende|spenden)(?=$|[^\p{L}])/iu,
    pillar: "orangecat",
    doors: [],
    reply: {
      en: "For getting paid, selling or raising money, OrangeCat is the place: you set up what you offer, and people pay you in Bitcoin.",
      de: "Um bezahlt zu werden, etwas zu verkaufen oder Geld zu sammeln, ist OrangeCat der richtige Ort: Du richtest ein, was du anbietest, und Leute bezahlen dich mit Bitcoin.",
    },
  },
];

/**
 * The answer when no model can be asked — the visitors' pool spent, every
 * vendor down. It still has to help: a studio door the visitor named, else a
 * recognised need (get paid, research, have something built), else the
 * products whose words match, else an honest "not yet" with a person to ask.
 *
 * It does not open by apologising. "A full answer isn't available right now"
 * opened every reply for weeks, which told every visitor the assistant was
 * broken before saying anything useful — they left on the first sentence.
 */
export function fallbackAnswer(
  message: string,
  map: FleetMap,
  appBase: string,
): { reply: string; links: ConciergeLink[] } {
  const lang: Lang = looksGerman(message) ? "de" : "en";

  // A question about the studio's own doors (partners, the course) is not a
  // project match: say where the door is before guessing from project words.
  const doors = STUDIO_DOORS.filter((d) => d.keys.some((k) => mentions(message, k)));
  if (doors.length > 0) {
    const list = doors.map((d) => d.label).join(lang === "de" ? " oder " : ", or ");
    return {
      reply: lang === "de" ? `Hier geht es los: ${list}.` : `This is the place to start: ${list}.`,
      links: doors.map((d) => ({ label: d.label, url: d.url })),
    };
  }

  // Products the visitor can open today, ranked by their words. Something not
  // running is a concept to read about, not an answer to a need.
  const usable = visibleProjects(map).filter((p) => p.status === "live" || p.status === "demo");
  const wanted = new Set(words(message));
  // A pillar's role line says what it is FOR ("move value … Bitcoin settlement")
  // in the words a visitor uses; its product copy often does not.
  const pillarRole = new Map(map.pillars.map((pl) => [pl.slug, pl.role]));
  const scored = usable
    .map((p) => {
      const name = new Set(words(`${p.name} ${p.slug}`));
      const body = new Set(
        words(
          [
            p.what,
            p.identity.problem,
            p.identity.solution,
            p.identity.mission,
            pillarRole.get(p.slug),
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      let score = 0;
      for (const w of wanted) {
        if (name.has(w)) score += 3;
        else if (body.has(w)) score += 1;
      }
      return { p, score };
    })
    // One shared word in a long description is chance, not a fit: that is how
    // every question used to be answered with the same safety product.
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const projectLinks = scored.map((s) => ({
    label: displayName(s.p),
    url: projectUrl(s.p, appBase),
  }));

  const intent = INTENTS.find((i) => i.re.test(message));
  if (intent) {
    const pillar = intent.pillar ? usable.find((p) => p.slug === intent.pillar) : undefined;
    const links = [
      ...(pillar ? [{ label: displayName(pillar), url: projectUrl(pillar, appBase) }] : []),
      ...intent.doors.map(door),
      ...projectLinks,
    ].filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i);
    return { reply: intent.reply[lang], links: links.slice(0, 3) };
  }

  if (scored.length > 0) {
    const names = scored.map((s) => displayName(s.p));
    const list = names.join(lang === "de" ? " oder " : " or ");
    return {
      reply:
        lang === "de"
          ? `Am nächsten an dem, was du beschreibst: ${list}. Wenn es das nicht ist, sag mir in einem Satz, was du erreichen möchtest.`
          : `Closest to what you describe: ${list}. If that isn't it, tell me in one sentence what you want to get done.`,
      links: projectLinks,
    };
  }

  return {
    reply:
      lang === "de"
        ? "Dafür habe ich hier noch nichts Passendes gefunden. Sag mir in einem Satz, was du erreichen möchtest – oder schreib direkt einer Person."
        : "I couldn't find something here for that yet. Tell me in one sentence what you want to get done — or write to a person directly.",
    links: [door("Ask a person"), door("See all projects")],
  };
}

/**
 * Lines that are not an answer but the model checking its own homework —
 * seen live from a fallback model: "Stage used: beta." / "No URLs written." /
 * "Loki first because building leads." They end in a full stop, so the
 * sentence trimmer keeps them, and they fold into the last speaker's bubble.
 * Dropped line by line; a line that is part of an answer never looks like one.
 */
const META_LINE =
  /^\s*[-*•]?\s*(?:\(?\s*)?(?:stage(?: word)?(?: used)?\s*[:=]|(?:no |zero )?urls?\s+(?:written|typed|included|given)|urls?\s*[:=]\s*(?:none|no)|links?\s*[:=]\s*(?:none|attached|no)|(?:cat|loki|both)\s+(?:first|only|speaks?|answers?)\s+(?:because|since|as)\b|format\s*[:=]|rules?\s+(?:followed|checked|applied)|(?:self[- ]?)?check(?:list)?\s*[:=]|note to self\b|(?:sentences?|sentence count)\s*[:=]\s*\d)/i;

/**
 * Markdown emphasis the widget would print as literal asterisks. The prompt
 * asks for plain text; this is the net for a model that forgets.
 */
export function stripEmphasis(reply: string): string {
  return reply.replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/__([^_\n]+?)__/g, "$1");
}

export function stripMeta(reply: string): string {
  return reply
    .split("\n")
    .filter((line) => !META_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

/**
 * Drop a trailing half sentence. A reasoning model spends hidden tokens out of
 * the same budget, so an answer can stop mid-clause ("…which is running, in")
 * while every other signal says it finished. Better one sentence fewer than a
 * visitor reading a thought that breaks off. A reply with no complete sentence
 * at all is kept as it is — something beats nothing.
 */
export function trimToLastSentence(text: string): string {
  const t = text.trimEnd();
  if (/[.!?…)"'»”]$/.test(t)) return t;
  const cut = Math.max(...[". ", "! ", "? ", ".\n", "!\n", "?\n"].map((m) => t.lastIndexOf(m)));
  return cut > 0 ? t.slice(0, cut + 1) : t;
}
