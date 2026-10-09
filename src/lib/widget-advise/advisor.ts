/**
 * The widget's Ask mode: a second opinion on the site, for the person the site
 * was built for.
 *
 * The situation it exists for: a builder sends a client the link to their new
 * site. The client is not a web professional. Left alone they file "I don't
 * like this" — or, worse, "move the button" about a button that sits exactly
 * where people expect it. Ask lets them put the question to Loki first:
 * is this right, why is it like this, should it change, and how would you make
 * the whole site better? The answer can say "leave it" as readily as "change
 * it", and every change it does recommend is one tap away from becoming a
 * request to the builder (the widget prefills Report with it).
 *
 * What it sees is an outline of the page — or of the element they picked, or of
 * several pages for "whole site" — built in the visitor's browser
 * (widget/page-snapshot.ts). It does not see pixels, and it is told to say so
 * rather than guess about colours it cannot check.
 *
 * Everything here is pure: strings in, strings out. The route does the I/O.
 */
import { fenceUntrusted, UNTRUSTED_PREAMBLE } from "@/lib/feedback/untrusted";

export type AdviseScope = "element" | "page" | "site";
export type AdviseTurn = { role: "user" | "assistant"; content: string };

/** Mirrors widget/advise.ts. */
export const ADVISE_MAX_QUESTION = 1000;
export const ADVISE_MAX_HISTORY = 8;
export const ADVISE_MAX_SNAPSHOT = 14_000;
/** Mirrors REVIEW_SESSION_MAX in widget/watch-trail.ts. */
export const ADVISE_MAX_SESSION = 6_000;
/** A change the client can send is one line a builder can act on, not an essay. */
export const ADVISE_MAX_CHANGE = 300;
export const ADVISE_MAX_CHANGES = 5;

/** The marker the model ends its answer with. Kept English and uppercase so it
 *  never appears in the prose of an answer in any language. */
export const CHANGES_MARKER = "CHANGES:";

const SCOPE_WORDS: Record<AdviseScope, string> = {
  element: "the element(s) they picked on this page",
  page: "this page",
  site: "the whole site (this page plus the other pages listed)",
};

/**
 * The review Watch asks for (the pill's Review button): the owner used their
 * site with Loki watching, and wants to know what Loki made of it. Five lenses,
 * because "something is off" is rarely only one kind of thing — a dead button
 * is an engineering defect, a design gap (nothing said it was working) and a
 * process smell (it shipped untested) at once, and the fix differs for each.
 *
 * Evidence-bound on purpose: every remark has to point at a step in the
 * session or a line of the page checks. A reviewer who invents problems is
 * worse than none — the owner acts on these.
 */
const REVIEW_RUBRIC = [
  "This is a REVIEW of a session: the owner just used their own site while you watched. The session below lists what they did, in order, with pauses, what the page and its requests did in response, and measured checks of the current page.",
  "Work out first what they were trying to do (one phrase), then judge how well the site served that, through these lenses — only the ones the evidence speaks to, worst first:",
  "- Errors: what broke or failed (failed requests, errors, dead taps, 4xx).",
  "- Design: friction a visitor feels — unclear labels, missing feedback after an action, long pauses before a step (they were looking for something), going back and forth, unreadable or tiny targets.",
  "- Engineering: slow requests, slow loads, the page freezing, layout jumping, console errors, accessibility gaps from the checks — and the likely cause in a phrase.",
  "- Process: what the evidence says about how the site is built and shipped — e.g. an error any test would have caught, a check that is clearly never run, the same failure twice.",
  "- Product: whether this flow serves what the site is for; a missing step, a feature the session shows is needed, or one that is in the way.",
  "Every point must cite its evidence from the session or checks (quote the step: 'you tapped button “Save” three times'). Never invent problems the session does not show; if the session is clean, say what worked and stop.",
  "Changes to request: at most THREE, worst first, and only what a visitor would notice or what is broken. Not alt text, spacing, margins, a renamed button, a table instead of a list, or any polish nobody asked for — five such lines with a button each is what made the owner stop reading (2026-10-09). One change that matters beats five that do not; none is a fine answer.",
  "Format: plain text, no markdown (it is shown as text on their site — asterisks would appear literally). A one-line read of what they were doing, then one line per finding starting with '- ' and its lens and a colon (e.g. '- Engineering: …'). Up to 300 words.",
].join("\n");

/**
 * What the advisor must never do, whoever is asking. Each line is a thing it
 * did on 2026-10-09 to a site's owner who asked for one new page: told them
 * which heading to insert and to "keep the structure in a data file
 * (JSON/YAML)", wrote five example sentences in the site's own language that
 * were nonsense, and answered "switch to Loki so I can develop it there" with
 * the same advice a third time. None of that is advice; it is the builder's
 * job handed back to the client.
 */
const HANDS_OFF_RULES = [
  "- Never explain how to edit the site — no headings to insert, markup, templates, data files, code, admin steps or “scalable design”. The person does not touch the site; whoever builds it does, from the change requests under your answer. Say what should change as a visitor would see it, and leave the how to the builder.",
  "- Never write the site's own content for it — no example sentences, copy, data or translations in the subject the site teaches or sells. The outline shows what exists; it is not material to extend. Say what the content must do and that the builder writes and checks it.",
  "- When they are asking for something to be built, added or changed (“add…”, “I want…”, “make…”, “change…”), do not advise them on it: in two or three sentences say what you understand they want and what would be built, ask one question only if something is genuinely unclear, and make the CHANGES list the request itself in their words — one line, or one per distinct part — never a procedure.",
  "- If they ask to take this into Loki, or to work on it in a chat or a terminal: say that “Continue in Loki” under the message box carries this conversation into Loki's chat on the project (or opens the project's terminal), and stop there.",
].join("\n");

export function adviseSystemPrompt(input: {
  scope: AdviseScope;
  snapshot: string;
  project?: { name: string; description?: string | null } | null;
  /** Watch's session record — present only for a Review. */
  session?: string | null;
  /** The owner's pass checked out: this is the person whose site it is. */
  owner?: boolean;
}): string {
  const about = input.project
    ? `The site belongs to the project "${input.project.name}"${
        input.project.description ? ` — ${input.project.description.slice(0, 400)}` : ""
      }.`
    : "";
  const session = input.session?.trim().slice(0, ADVISE_MAX_SESSION) ?? "";
  return [
    "You are Loki, a senior web product advisor, embedded on a website that someone built.",
    input.owner
      ? "The person asking OWNS this site, and Loki builds it for them: when they tap “Build this”, an agent makes the change on the live site. They are the client, not the builder — never the person who edits it."
      : "The person asking is most likely the site's owner — the builder's client — looking at their site. They are usually not a web professional, and they never edit the site themselves: whoever builds it does, from the change requests under your answer.",
    about,
    `They are asking about ${SCOPE_WORDS[input.scope]}.`,
    "",
    "How to answer:",
    "- Judge the site against what it is for: who visits, what those visitors came to do, and whether the page makes that easy. Name that purpose in a phrase when it matters to the answer.",
    "- Be honest in both directions. If something is a sound choice, say so and say WHY (a convention visitors expect, readability, mobile use, accessibility, conversion). Recommending to leave something alone is a good answer when it is true.",
    "- When something should change, say what and why, most important first. Concrete beats general: quote the actual headline, button or section.",
    "- Plain language. No jargon; if a term is unavoidable, explain it in five words.",
    "- You see a text outline of the page (structure, wording, links, forms, some computed styles) — not a screenshot. Do not claim anything about looks you cannot see; say it is worth checking instead.",
    "- Never invent content, numbers or pages that are not in the outline.",
    "- Short: under 180 words unless they asked for a full review. No headings; short paragraphs or a few bullets.",
    "- Answer in the language the person wrote in.",
    HANDS_OFF_RULES,
    "",
    // A review's length and shape are the rubric's, not the 180-word default.
    session ? REVIEW_RUBRIC : "",
    `End with a line \`${CHANGES_MARKER}\` followed by up to ${ADVISE_MAX_CHANGES} bullet lines, each ONE concrete change request the owner could send to their builder as-is — imperative, self-contained, naming the thing to change (e.g. "- Change the hero button text from 'Submit' to 'Book a table'"). If you recommend changing nothing, write \`${CHANGES_MARKER} none\`.`,
    "",
    session ? UNTRUSTED_PREAMBLE : "",
    session ? fenceUntrusted("SESSION", session) : "",
    "What you can see:",
    input.snapshot.slice(0, ADVISE_MAX_SNAPSHOT),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function advisePrompt(history: AdviseTurn[], question: string): string {
  const past = history
    .slice(-ADVISE_MAX_HISTORY)
    .map((t) => `${t.role === "user" ? "Owner" : "Loki"}: ${t.content}`)
    .join("\n");
  return `${past ? `${past}\n` : ""}Owner: ${question}\nLoki:`;
}

/**
 * Split the model's text into the answer the person reads and the change
 * requests they can send. Total: a model that ignored the format yields its
 * whole text as the answer and no changes — never an error.
 */
export function splitAdvice(text: string): { answer: string; changes: string[] } {
  const idx = text.search(/^\s*(?:\*\*)?CHANGES:?(?:\*\*)?:?/im);
  if (idx < 0) return { answer: text.trim(), changes: [] };
  const answer = text.slice(0, idx).trim();
  const tail = text.slice(idx).replace(/^\s*(?:\*\*)?CHANGES:?(?:\*\*)?:?/i, "");
  const changes: string[] = [];
  for (const raw of tail.split("\n")) {
    const line = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (!line || /^none\.?$/i.test(line)) continue;
    changes.push(line.slice(0, ADVISE_MAX_CHANGE));
    if (changes.length >= ADVISE_MAX_CHANGES) break;
  }
  return { answer: answer || text.slice(0, idx).trim(), changes };
}

/**
 * The widget shows answers as TEXT (model output on someone else's site), so
 * markdown emphasis would appear as literal asterisks. Models add it whatever
 * the prompt says; unwrap it rather than ship "**Errors:**" to a client.
 */
export function plainAnswer(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1");
}

/**
 * What the person reads when no model can answer. It still leaves them a way
 * forward — the question itself, sent to the builder — instead of a wall.
 */
export const ADVISE_UNAVAILABLE =
  "I can't look at this right now. You can still send your question to the person who built the site — it lands with them either way.";
