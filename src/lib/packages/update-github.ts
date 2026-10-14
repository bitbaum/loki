/**
 * The GitHub calls package updates need, behind one interface so the logic in
 * ./updates.ts can be tested with a fake.
 *
 * Budget: the open-pull-request listing is read every 15 minutes for every
 * project that uses a fleet package, so it is a CONDITIONAL request — GitHub
 * answers 304 when nothing changed, and a 304 to an authenticated request does
 * not count against the hourly limit. Checks are read only for a head commit
 * whose checks are not already known to have finished (./updates.ts).
 */
import { GITHUB_API_BASE } from "@/lib/github-api";
import type { RepoRef } from "@/lib/github-repo-ref";

const REQUEST_TIMEOUT_MS = 6_000;

export type GithubPull = {
  number: number;
  url: string;
  title: string;
  body: string | null;
  headSha: string | null;
  authorLogin: string | null;
  authorType: string | null;
  labels: string[];
  createdAt: string | null;
  state: "open" | "closed";
  merged: boolean;
};

export type WriteResult = { ok: true } | { ok: false; status: number; message: string };

export interface UpdateGithub {
  /** May this client write (labels, comments, merges)? False with no token. */
  readonly canWrite: boolean;
  /** Open pull requests, newest first. Throws when GitHub cannot be read. */
  listOpenPulls(ref: RepoRef): Promise<GithubPull[]>;
  /** One pull request, or null when it cannot be read. */
  getPull(ref: RepoRef, number: number): Promise<GithubPull | null>;
  /** Check conclusions on a commit (null = still running); null when unreadable. */
  checkConclusions(ref: RepoRef, sha: string): Promise<(string | null)[] | null>;
  addLabel(ref: RepoRef, number: number, label: string): Promise<WriteResult>;
  removeLabel(ref: RepoRef, number: number, label: string): Promise<WriteResult>;
  comment(ref: RepoRef, number: number, body: string): Promise<WriteResult>;
  merge(ref: RepoRef, number: number, title: string): Promise<WriteResult>;
}

/** The pulls listing, by URL and credential, with GitHub's ETag — kept across reads. */
const listingCache = new Map<string, { etag: string; pulls: GithubPull[] }>();

/** GitHub's pull-request JSON → the fields Loki reads. Pure; exported for the test. */
export function readPull(raw: unknown): GithubPull | null {
  const j = raw as Record<string, unknown> | null;
  if (!j || typeof j.number !== "number" || typeof j.html_url !== "string") return null;
  const user = (j.user ?? null) as { login?: unknown; type?: unknown } | null;
  const head = (j.head ?? null) as { sha?: unknown } | null;
  const labels = Array.isArray(j.labels) ? j.labels : [];
  return {
    number: j.number,
    url: j.html_url,
    title: typeof j.title === "string" ? j.title : `#${j.number}`,
    body: typeof j.body === "string" ? j.body : null,
    headSha: typeof head?.sha === "string" ? head.sha : null,
    authorLogin: typeof user?.login === "string" ? user.login : null,
    authorType: typeof user?.type === "string" ? user.type : null,
    labels: labels.flatMap((l) =>
      l && typeof (l as { name?: unknown }).name === "string" ? [(l as { name: string }).name] : [],
    ),
    createdAt: typeof j.created_at === "string" ? j.created_at : null,
    state: j.state === "closed" ? "closed" : "open",
    merged: typeof j.merged_at === "string" || j.merged === true,
  };
}

async function messageOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message.slice(0, 200) : `HTTP ${res.status}`;
}

/** The real client. `token` null reads public repositories and writes nothing. */
export function githubUpdateClient(token: string | null): UpdateGithub {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const get = (url: string, extra?: Record<string, string>) =>
    fetch(url, {
      headers: headers(extra),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const write = async (url: string, method: string, body?: unknown): Promise<WriteResult> => {
    if (!token) return { ok: false, status: 0, message: "no GitHub token" };
    try {
      const res = await fetch(url, {
        method,
        headers: headers(body === undefined ? {} : { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return res.ok
        ? { ok: true }
        : { ok: false, status: res.status, message: await messageOf(res) };
    } catch (err) {
      return { ok: false, status: 0, message: err instanceof Error ? err.message : "failed" };
    }
  };
  const repo = (ref: RepoRef) => `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}`;

  return {
    canWrite: token !== null,

    async listOpenPulls(ref) {
      const url = `${repo(ref)}/pulls?state=open&per_page=50`;
      const key = `${url}|${token ? token.slice(-8) : "anon"}`;
      const cached = listingCache.get(key);
      const res = await get(url, cached ? { "If-None-Match": cached.etag } : {});
      if (res.status === 304 && cached) return cached.pulls;
      if (!res.ok) throw new Error(`GitHub listed no pull requests (HTTP ${res.status})`);
      const rows = (await res.json()) as unknown;
      const pulls = Array.isArray(rows)
        ? rows.flatMap((r) => {
            const p = readPull(r);
            return p ? [p] : [];
          })
        : [];
      const etag = res.headers.get("etag");
      if (etag) listingCache.set(key, { etag, pulls });
      return pulls;
    },

    async getPull(ref, number) {
      const res = await get(`${repo(ref)}/pulls/${number}`).catch(() => null);
      if (!res?.ok) return null;
      return readPull(await res.json().catch(() => null));
    },

    async checkConclusions(ref, sha) {
      // check-runs covers GitHub Actions, commit statuses older integrations —
      // the same pair fix-shipping-refresh reads.
      const at = `${repo(ref)}/commits/${encodeURIComponent(sha)}`;
      const [runs, status] = await Promise.all([
        get(`${at}/check-runs?per_page=50`).catch(() => null),
        get(`${at}/status`).catch(() => null),
      ]);
      if (!runs?.ok && !status?.ok) return null;
      const out: (string | null)[] = [];
      if (runs?.ok) {
        const j = (await runs.json().catch(() => null)) as {
          check_runs?: Array<{ status?: string; conclusion?: string | null }>;
        } | null;
        for (const r of j?.check_runs ?? [])
          out.push(r.status === "completed" ? (r.conclusion ?? null) : null);
      }
      if (status?.ok) {
        const j = (await status.json().catch(() => null)) as {
          statuses?: Array<{ state?: string }>;
        } | null;
        for (const s of j?.statuses ?? [])
          out.push(s.state === "pending" ? null : s.state === "success" ? "success" : "failure");
      }
      return out;
    },

    addLabel: (ref, number, label) =>
      write(`${repo(ref)}/issues/${number}/labels`, "POST", { labels: [label] }),

    async removeLabel(ref, number, label) {
      const res = await write(
        `${repo(ref)}/issues/${number}/labels/${encodeURIComponent(label)}`,
        "DELETE",
      );
      // Already gone is the outcome that was wanted.
      return !res.ok && res.status === 404 ? { ok: true } : res;
    },

    comment: (ref, number, body) =>
      write(`${repo(ref)}/issues/${number}/comments`, "POST", { body }),

    merge: (ref, number, title) =>
      write(`${repo(ref)}/pulls/${number}/merge`, "PUT", {
        merge_method: "squash",
        commit_title: `${title} (#${number})`,
        commit_message: "Merged by Loki: a breaking package update its owner approved.",
      }),
  };
}
