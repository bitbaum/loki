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

export type AdviseScope = "element" | "page" | "site";
export type AdviseTurn = { role: "user" | "assistant"; content: string };

/** Mirrors widget/advise.ts. */
export const ADVISE_MAX_QUESTION = 1000;
export const ADVISE_MAX_HISTORY = 8;
export const ADVISE_MAX_SNAPSHOT = 14_000;
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

export function adviseSystemPrompt(input: {
  scope: AdviseScope;
  snapshot: string;
  project?: { name: string; description?: string | null } | null;
}): string {
  const about = input.project
    ? `The site belongs to the project "${input.project.name}"${
        input.project.description ? ` — ${input.project.description.slice(0, 400)}` : ""
      }.`
    : "";
  return [
    "You are Loki, a senior web product advisor, embedded on a website that someone built.",
    "The person asking is most likely the site's owner — the builder's client — reviewing their new site. They are usually not a web professional.",
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
    "",
    `End with a line \`${CHANGES_MARKER}\` followed by up to ${ADVISE_MAX_CHANGES} bullet lines, each ONE concrete change request the owner could send to their builder as-is — imperative, self-contained, naming the thing to change (e.g. "- Change the hero button text from 'Submit' to 'Book a table'"). If you recommend changing nothing, write \`${CHANGES_MARKER} none\`.`,
    "",
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
 * What the person reads when no model can answer. It still leaves them a way
 * forward — the question itself, sent to the builder — instead of a wall.
 */
export const ADVISE_UNAVAILABLE =
  "I can't look at this right now. You can still send your question to the person who built the site — it lands with them either way.";
