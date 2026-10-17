/**
 * What changed, written down so Loki can SHOW it.
 *
 * A preview made from a live site used to end with improvements.html — a page
 * the build agent wrote freehand, which Loki could neither check nor
 * illustrate. Now the build leaves improvements.json: one entry per change,
 * each naming the live page it is about and the file here that shows it, plus
 * the engineer's account under the same keys the pull-request walkthrough
 * uses (lib/feedback/fix-note). Loki renders the before-and-after tour from
 * it, photographs both pages itself, and puts the account on the watch page —
 * so what the owner sees is never a page an agent styled at 2 a.m.
 *
 * Pure: the instruction the agent reads is rendered from the same field list
 * the parser validates, so the two cannot drift. Pinned in
 * scripts/test/preview-improvements.ts.
 */
import { z } from "zod";
import { FIX_NOTE_FIELDS, tidyFixNote, type FixNote } from "@/lib/feedback/fix-note";

export const IMPROVEMENTS_FILE = "improvements.json";
/** Loki's own files inside a preview folder (source, pictures): git-ignored, never served. */
export const LOKI_DIR = ".loki";
/**
 * Loki's own pages inside a preview, under a path no site uses:
 * `_loki/before-after` is the tour, `_loki/picture?side=…&i=…` its pictures
 * (lib/previews/handle). Both sit behind the same access code as the site.
 */
export const LOKI_PATH = "_loki";
/** What the preview was made from — see PreviewSource. */
export const SOURCE_FILE = `${LOKI_DIR}/source.json`;

/** What the agent is asked to write for every change, in the order shown. */
export const CHANGE_FIELDS = [
  { key: "title", ask: "the change in a few words, as the owner would say it" },
  {
    key: "livePath",
    ask: "the path of the live page this is about ('/' for the homepage, '/kontakt', …)",
  },
  {
    key: "newPath",
    ask: "the file in this folder that shows it (index.html, kontakt/index.html, …)",
  },
  { key: "before", ask: "what a visitor got on the live page — one or two sentences" },
  { key: "after", ask: "what they get on the new page" },
  { key: "why", ask: "why it matters to their visitors or their business" },
] as const;

/** The walkthrough keys a preview build can answer (no PR, so no `where`/`plain`). */
const WALKTHROUGH_KEYS = [
  "problem",
  "change",
  "why",
  "considered",
  "helps",
  "us",
  "downsides",
  "costs",
  "proof",
  "next",
] as const;

const TEXT_MAX = 600;
const text = (max = TEXT_MAX) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max))
    .catch("");

const Change = z.object({
  title: text(120),
  livePath: text(300),
  newPath: text(300),
  before: text(),
  after: text(),
  why: text(),
});

const Walkthrough = z
  .object({
    problem: text(),
    change: text(),
    why: text(),
    considered: z.array(z.string().max(TEXT_MAX)).max(3).catch([]),
    helps: text(),
    us: text(),
    downsides: text(),
    costs: text(),
    proof: text(),
    next: text(),
  })
  .partial();

const Improvements = z.object({
  /** The site's language, for the tour page's chrome (BCP 47). */
  lang: z.string().trim().max(12).optional().catch(undefined),
  headline: text(200).optional(),
  changes: z.array(Change).max(12).catch([]),
  notBroughtOver: z.array(z.string().max(300)).max(20).catch([]),
  questions: z.array(z.string().max(300)).max(10).catch([]),
  walkthrough: Walkthrough.optional().catch(undefined),
});
export type Improvements = z.infer<typeof Improvements>;
export type ImprovementChange = z.infer<typeof Change>;

/** The file as written by an agent: JSON, or null when it is missing or not a JSON object. */
export function parseImprovements(raw: string | null | undefined): Improvements | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = Improvements.safeParse(data);
  if (!parsed.success) return null;
  const value = parsed.data;
  value.changes = value.changes.filter((c) => c.title);
  return value;
}

/** The instruction in the build brief — one rule, rendered from the fields above. */
export function improvementsInstruction(): string {
  const ask = (key: string) => FIX_NOTE_FIELDS.find((f) => f.key === key)?.ask ?? key;
  return [
    `Write ${IMPROVEMENTS_FILE} in this folder (UTF-8 JSON, no comments). Loki turns it into the before-and-after tour the owner sees — the live page and the new page photographed side by side — and into the engineer's account on the watch page, so write for the owner, in their language, and only about what you actually changed. Shape:`,
    `{ "lang": "<the site's language, e.g. ru or de-CH>", "headline": "<one sentence: what the owner will notice first>",`,
    `  "changes": [ { ${CHANGE_FIELDS.map((f) => `"${f.key}": "<${f.ask}>"`).join(", ")} } ],  // the change they will notice most first; at most 12`,
    `  "notBroughtOver": ["<anything from the live site you could not bring over, and why>"],`,
    `  "questions": ["<what the owner should be asked>"],`,
    `  "walkthrough": { ${WALKTHROUGH_KEYS.map((k) => (k === "considered" ? `"considered": ["<option> — <why not>", …]` : `"${k}": "<${ask(k)}>"`)).join(", ")} } }`,
  ].join("\n");
}

/**
 * What a preview was made from. Loki writes it beside the folder's own files
 * when the preview starts from a website (lib/previews/from-website), and
 * reads it to know which live site the "before" pictures show.
 */
export type PreviewSource = {
  website: string;
  /** The live pages the consultation read, homepage first. */
  pages: string[];
  createdAt: string;
};

const Source = z.object({
  website: z.string().url(),
  pages: z.array(z.string().url()).max(20).catch([]),
  createdAt: z.string().catch(""),
});

export function parsePreviewSource(raw: string | null | undefined): PreviewSource | null {
  if (!raw) return null;
  try {
    const parsed = Source.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One row of the tour: a live page and the file here that replaces it. */
export type BeforeAfterPair = {
  title: string;
  /** The live page, on the site the preview was made from. */
  liveUrl: string;
  /** The new page: a file path inside the folder ("o-nas/index.html"). */
  newPath: string;
  before: string;
  after: string;
  why: string;
  /** Named by the agent (shown even if its file is missing) or inferred from the tour. */
  fromAgent: boolean;
};

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** "/o-nas", "o-nas/", "/o-nas/index.html" → "o-nas/index.html"; "" → "index.html". */
export function fileForPath(given: string): string {
  let p = given
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\\/g, "/");
  try {
    p = decodeURI(p);
  } catch {
    /* as typed */
  }
  p = p.replace(/[?#].*$/, "");
  if (!p || p === "/") return "index.html";
  if (p.endsWith("/")) return `${p}index.html`;
  const last = p.split("/").pop() ?? "";
  return last.includes(".") ? p : `${p}/index.html`;
}

/** A path the agent named, kept on the live site; anything else falls back to its root. */
function liveUrlFor(path: string, website: string): string {
  try {
    const url = new URL(path || "/", website);
    if (bareHost(url.hostname) !== bareHost(new URL(website).hostname)) return website;
    url.hash = "";
    return url.href;
  } catch {
    return website;
  }
}

/** A live URL as a short title: "/" → "The homepage", "/o-nas" → "o-nas". */
function titleFor(liveUrl: string, website: string): string {
  try {
    const path = new URL(liveUrl).pathname.replace(/\/+$/, "");
    if (!path) return "The homepage";
    let readable = path;
    try {
      readable = decodeURI(path);
    } catch {
      /* as is */
    }
    return readable.replace(/^\//, "");
  } catch {
    return website;
  }
}

/**
 * The rows of the tour. The agent's list first, in its order; when the agent
 * left none, every live page the consultation read, paired with the file at
 * the same path — the brief asks the build to keep the live site's paths, so
 * a site rebuilt without the file still shows its homepage side by side.
 */
export function beforeAfterPairs(
  source: PreviewSource | null,
  improvements: Improvements | null,
): BeforeAfterPair[] {
  const website = source?.website ?? null;
  const fromAgent = (improvements?.changes ?? []).flatMap((c) => {
    const liveUrl = website ? liveUrlFor(c.livePath, website) : null;
    if (!liveUrl) return [];
    return [
      {
        title: c.title,
        liveUrl,
        newPath: fileForPath(c.newPath || c.livePath),
        before: c.before,
        after: c.after,
        why: c.why,
        fromAgent: true,
      },
    ];
  });
  if (fromAgent.length || !website) return fromAgent;
  const pages = source!.pages.length ? source!.pages : [website];
  return pages.map((liveUrl) => {
    let path = "/";
    try {
      path = new URL(liveUrl).pathname;
    } catch {
      /* the homepage */
    }
    return {
      title: titleFor(liveUrl, website),
      liveUrl,
      newPath: fileForPath(path),
      before: "",
      after: "",
      why: "",
      fromAgent: false,
    };
  });
}

/** The engineer's account, as the watch page's Walkthrough draws it. */
export function walkthroughFrom(improvements: Improvements | null): FixNote | null {
  const w = improvements?.walkthrough;
  if (!w) return null;
  const note = tidyFixNote({
    problem: w.problem || null,
    change: w.change || null,
    why: w.why || null,
    considered: (w.considered ?? []).map((line) => ({ option: line, whyNot: null })),
    helps: w.helps || null,
    us: w.us || null,
    downsides: w.downsides || null,
    costs: w.costs || null,
    proof: w.proof || null,
    next: w.next || null,
    shows: "page",
    detail: null,
    where: null,
    plain: null,
  });
  return note.problem || note.change || note.helps || note.why ? note : null;
}
