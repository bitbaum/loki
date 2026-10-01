/**
 * The building-in-public records a project keeps IN ITS OWN REPOSITORY:
 * `ROADMAP.md` and `CHANGELOG.md` at the root, in the dialect documented in
 * docs/architecture/building-in-public-records.md.
 *
 * Why the repo and not only the database. Audited 2026-09-28: the only
 * producers were the `goals` table and the `dev_log` column. 19 of 34 projects
 * had goals, nearly all of them one machine-seeded placeholder ("Make <x>
 * development and verification public", 0 of 3 steps done); the changelogs
 * were dev-log run notes. Meanwhile four products kept a local copy of their
 * roadmap that the SSOT forbids, and two had no pages at all. A record that
 * lives next to the code, is reviewed in the same pull request as the change
 * it describes, and is public because the repository is, cannot rot the same
 * way. So the map reads the files, and the file is the record wherever it
 * exists; goals and the dev log remain the record for projects without one.
 *
 * Pure parsing lives here with no I/O so it can be unit-tested; the fetch is
 * the small function at the bottom.
 */
import type { MapProfile } from "./map";

/** A goal-shaped row plus the one line the file's author wrote under the title. */
export type RepoRoadmapItem = NonNullable<MapProfile["goals"]>[number] & { line: string | null };
/** One bullet (or prose paragraph) of an entry, whole: every continuation line joined. */
export type RepoChangelogItem = {
  /** The `**Bold lead.**` a bullet opens with, when it has one. */
  lead: string | null;
  /** The rest of the bullet, as plain text. */
  text: string;
};
/** A `###` sub-section of an entry (Added / Fixed / Changed); `heading` null before the first. */
export type RepoChangelogSection = { heading: string | null; items: RepoChangelogItem[] };
export type RepoChangelogEntry = {
  date: string;
  /** Whatever the heading says besides the date ("Scoped portal", "0.8.0"), or null. */
  title: string | null;
  /** Every item as one line of plain text, newline-separated — the map's shape. */
  done: string;
  /** The same items with their sub-headings, for a page that renders the structure. */
  sections: RepoChangelogSection[];
};

export type RepoRecords = {
  roadmap: RepoRoadmapItem[];
  changelog: RepoChangelogEntry[];
  /** Blob URLs of the files that produced them, for provenance links. */
  source: { roadmap: string | null; changelog: string | null };
};

/** Bucket heading → the status word the map publishes. Anything else is used verbatim. */
function statusForBucket(title: string): string {
  const t = title.trim().toLowerCase();
  if (/^(now|in progress|doing|building|shipping now|current)\b/.test(t)) return "in progress";
  if (/^(next|planned|soon|up next)\b/.test(t)) return "planned";
  if (/^(later|someday|future|beyond|after that)\b/.test(t)) return "later";
  if (/^(shipped|done|delivered|live|completed)\b/.test(t)) return "done";
  return t;
}

/** Strip the inline markdown a record line may carry so it reads as prose. */
export function plainText(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) =>
      /^https?:\/\//.test(href) ? `${text} (${href})` : text,
    )
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRoadmapMarkdown(md: string): RepoRoadmapItem[] {
  const items: RepoRoadmapItem[] = [];
  let status: string | null = null;
  let current: RepoRoadmapItem | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bucket = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (bucket) {
      status = statusForBucket(bucket[1]);
      current = null;
      continue;
    }
    const item = /^###\s+(.+?)\s*#*\s*$/.exec(line);
    if (item) {
      const title = plainText(item[1]);
      if (!title) continue;
      current = { title, line: null, status, progress: null, targetDate: null, milestones: [] };
      items.push(current);
      continue;
    }
    if (!current) continue;
    const target = /^\s*\*{0,2}target\*{0,2}\s*:\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/i.exec(line);
    if (target) {
      current.targetDate = plainText(target[1]) || null;
      continue;
    }
    const step = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (step) {
      const title = plainText(step[2]);
      if (title) current.milestones!.push({ title, done: step[1] !== " " });
      continue;
    }
    // The first prose line under the title is the item's one-liner; anything
    // after it is detail for the file's own readers.
    if (current.line === null && line.trim() && !/^[-*#>]/.test(line.trim())) {
      current.line = plainText(line) || null;
    }
  }
  for (const it of items) {
    const steps = it.milestones ?? [];
    if (it.status === "done") it.progress = 100;
    else if (steps.length)
      it.progress = Math.round((steps.filter((m) => m.done).length / steps.length) * 100);
  }
  return items;
}

/** "2026-07-03 (c)" → null; "2026-09-30 — Scoped portal" → "Scoped portal"; "[0.8.0] - 2026-08-14" → "0.8.0". */
function entryTitle(heading: string, date: string): string | null {
  const rest = plainText(heading.replace(date, " "))
    .replace(/[[\]]/g, "")
    .replace(/^[\s—–:·-]+|[\s—–:·-]+$/g, "")
    .replace(/^\([a-z]\)$/i, "")
    .trim();
  return rest || null;
}

/** A whole bullet's markdown → its bold lead (if it opens with one) and the rest, as plain text. */
function toItem(raw: string): RepoChangelogItem | null {
  const md = raw.replace(/\s+/g, " ").trim();
  // A lead is bold that ends at a word boundary: "**Prompts is a grid**, and"
  // is emphasis inside a sentence, not a lead, and splitting it would print
  // "grid , and".
  const bold = /^(\*\*|__)(.+?)\1(?:\s+(.*))?$/.exec(md);
  const lead = bold ? plainText(bold[2]) || null : null;
  const text = plainText(bold ? (bold[3] ?? "") : md);
  return lead || text ? { lead, text } : null;
}

function itemLine(item: RepoChangelogItem): string {
  return [item.lead, item.text].filter(Boolean).join(" ");
}

/**
 * CHANGELOG.md → dated entries, newest first, nothing dropped.
 *
 * Every bullet is kept WHOLE. Entries are written as wrapped markdown — a
 * bullet's second line is indented under its first — and this parser used to
 * keep only the line carrying the dash, so the public page printed "Five
 * essays in Thoughts showed" and stopped. It also dropped `###` sub-headings,
 * dropped any entry written as prose instead of bullets (a month-long summary
 * vanished, so the page jumped from August 14 to September 22), cut each
 * entry at 700 characters, and kept only the newest 40 entries. None of that
 * is the parser's call: the file's author decides what is in the record.
 * scripts/test/changelog-own-file.ts holds Loki's own file to this.
 *
 * Nested bullets remain detail on the line above them and are dropped.
 */
export function parseChangelogMarkdown(md: string): RepoChangelogEntry[] {
  const entries: RepoChangelogEntry[] = [];
  type OpenSection = { heading: string | null; items: string[] };
  let current: { date: string; title: string | null; sections: OpenSection[] } | null = null;
  // What the last non-blank line belonged to: a top-level bullet (its
  // continuations join it), a nested bullet (dropped, with its continuations),
  // or a prose paragraph (consecutive lines join).
  let mode = null as "bullet" | "nested" | "prose" | null;
  let afterBlank = false;

  const lastSection = (sections: OpenSection[]): OpenSection => {
    if (sections.length === 0) sections.push({ heading: null, items: [] });
    return sections[sections.length - 1];
  };
  const open = <M extends "bullet" | "prose">(sections: OpenSection[], text: string, as: M): M => {
    lastSection(sections).items.push(text);
    return as;
  };
  const append = (sections: OpenSection[], text: string) => {
    const items = lastSection(sections).items;
    if (items.length === 0) items.push(text);
    else items[items.length - 1] += ` ${text}`;
  };
  const flush = () => {
    if (!current) return;
    const sections = current.sections
      .map((s) => ({
        heading: s.heading,
        items: s.items.map(toItem).filter((i): i is RepoChangelogItem => i !== null),
      }))
      .filter((s) => s.items.length > 0);
    const done = sections.flatMap((s) => s.items.map(itemLine)).join("\n");
    if (done) entries.push({ date: current.date, title: current.title, done, sections });
    current = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const date = /(\d{4}-\d{2}-\d{2})/.exec(heading[1]);
      current = date
        ? { date: date[1], title: entryTitle(heading[1], date[1]), sections: [] }
        : null;
      mode = null;
      afterBlank = false;
      continue;
    }
    if (!current) continue;
    const sections = current.sections;
    if (!line.trim()) {
      afterBlank = true;
      if (mode === "prose") mode = null;
      continue;
    }
    const sub = /^#{3,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (sub) {
      sections.push({ heading: plainText(sub[1]) || null, items: [] });
      mode = null;
    } else if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) {
      mode = open(sections, line.replace(/^(?:[-*+]|\d+[.)])\s+/, ""), "bullet");
    } else if (/^\s+(?:[-*+]|\d+[.)])\s+/.test(line)) {
      // A nested bullet is detail on the line above it.
      if (mode === "bullet" || mode === "nested") mode = "nested";
    } else if (/^\s/.test(line)) {
      if (mode === "bullet" || mode === "prose") append(sections, line.trim());
      else if (mode !== "nested") mode = open(sections, line.trim(), "prose");
    } else {
      const text = line.replace(/^>\s?/, "");
      // Unindented text right under a bullet is markdown's lazy continuation.
      if ((mode === "bullet" && !afterBlank) || mode === "prose") append(sections, text);
      else mode = open(sections, text, "prose");
    }
    afterBlank = false;
  }
  flush();
  // Stable sort: same-day entries keep the file's order.
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** `https://github.com/owner/repo(.git)` → `owner/repo`, else null. */
export function githubRepoPath(gitUrl: string | null | undefined): string | null {
  if (!gitUrl) return null;
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(gitUrl.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function recordUrls(repoPath: string): {
  raw: { roadmap: string; changelog: string };
  blob: { roadmap: string; changelog: string };
} {
  return {
    raw: {
      roadmap: `https://raw.githubusercontent.com/${repoPath}/HEAD/ROADMAP.md`,
      changelog: `https://raw.githubusercontent.com/${repoPath}/HEAD/CHANGELOG.md`,
    },
    blob: {
      roadmap: `https://github.com/${repoPath}/blob/HEAD/ROADMAP.md`,
      changelog: `https://github.com/${repoPath}/blob/HEAD/CHANGELOG.md`,
    },
  };
}

/** Fold fetched files into records. Exported for tests; the fetch is below. */
export function recordsFromFiles(
  repoPath: string,
  files: { roadmap: string | null; changelog: string | null },
): RepoRecords {
  const urls = recordUrls(repoPath);
  return {
    roadmap: files.roadmap ? parseRoadmapMarkdown(files.roadmap) : [],
    changelog: files.changelog ? parseChangelogMarkdown(files.changelog) : [],
    source: {
      roadmap: files.roadmap ? urls.blob.roadmap : null,
      changelog: files.changelog ? urls.blob.changelog : null,
    },
  };
}

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; records: RepoRecords }>();

async function fetchText(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * The two record files of one GitHub repository, parsed. Cached in-process for
 * ten minutes: the map is rebuilt on every request and every nightly reindex,
 * and 35 projects would otherwise be 70 raw.githubusercontent.com calls each
 * time. A private repository (404) yields empty records, not an error — the
 * map already says "nothing recorded" and that is the honest answer for it.
 */
export async function loadRepoRecords(
  gitUrl: string | null | undefined,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<RepoRecords | null> {
  const repoPath = githubRepoPath(gitUrl);
  if (!repoPath) return null;
  const hit = cache.get(repoPath);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.records;
  const urls = recordUrls(repoPath);
  const [roadmap, changelog] = await Promise.all([
    fetchText(urls.raw.roadmap, fetcher),
    fetchText(urls.raw.changelog, fetcher),
  ]);
  const records = recordsFromFiles(repoPath, { roadmap, changelog });
  cache.set(repoPath, { at: now, records });
  return records;
}

/** Test seam. */
export function clearRepoRecordsCache(): void {
  cache.clear();
}
