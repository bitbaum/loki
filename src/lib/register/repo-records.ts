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
export type RepoChangelogEntry = { date: string; done: string };

export type RepoRecords = {
  roadmap: RepoRoadmapItem[];
  changelog: RepoChangelogEntry[];
  /** Blob URLs of the files that produced them, for provenance links. */
  source: { roadmap: string | null; changelog: string | null };
};

const ENTRY_MAX_CHARS = 700;
const CHANGELOG_MAX_ENTRIES = 40;

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

export function parseChangelogMarkdown(md: string): RepoChangelogEntry[] {
  const entries: RepoChangelogEntry[] = [];
  let current: { date: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const done = current.lines.join("\n").trim();
    if (done) {
      entries.push({
        date: current.date,
        done: done.length > ENTRY_MAX_CHARS ? `${done.slice(0, ENTRY_MAX_CHARS - 1)}…` : done,
      });
    }
    current = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const date = /(\d{4}-\d{2}-\d{2})/.exec(heading[1]);
      current = date ? { date: date[1], lines: [] } : null;
      continue;
    }
    if (!current) continue;
    // Top-level bullets only: a nested bullet is detail on the line above it.
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = plainText(bullet[1]);
      if (text) current.lines.push(text);
    }
  }
  flush();
  return entries.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, CHANGELOG_MAX_ENTRIES);
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
