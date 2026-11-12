/**
 * Repo-side work evidence: the shape, and the one way to trust a value
 * claiming to be it. No imports on purpose.
 *
 * It lived in github-evidence.ts, which fetches from the GitHub API and pulls
 * in Next's fetch extensions. The moment control-types imported the TYPE from
 * there, the desktop package's typecheck started walking that chain and broke
 * on `next: { revalidate }`, which does not exist in its DOM lib. A shape that
 * both a client type and a server fetcher need belongs below both of them.
 */

export type RepoWorkEvidence = {
  kind: "pr" | "push";
  url: string;
  title: string;
  /** When the PR was opened / the push happened, epoch ms. */
  atMs: number;
};

/**
 * jsonb -> RepoWorkEvidence, or null.
 *
 * Evidence is stored in a jsonb payload, so `kind` arrives as a bare string
 * however it was written, and the card renders different words per kind. An
 * unrecognised shape drops the whole block rather than shipping a link
 * labelled by a value nothing checked.
 */
export function normalizeRepoWorkEvidence(value: unknown): RepoWorkEvidence | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (e.kind !== "pr" && e.kind !== "push") return null;
  if (typeof e.url !== "string" || !e.url) return null;
  if (typeof e.title !== "string") return null;
  if (typeof e.atMs !== "number" || !Number.isFinite(e.atMs)) return null;
  return { kind: e.kind, url: e.url, title: e.title, atMs: e.atMs };
}

/**
 * The pull request a runner reported when it closed a run on it
 * (closeRunShipped writes `payload.prUrl`: the agent's own pull request, seen
 * at its HEAD), as evidence. Nothing read that field, so the message posted
 * for a run that shipped could say no pull request was found. Null when the
 * payload carries no pull request address.
 */
export function reportedPrEvidence(payload: unknown, atMs: number): RepoWorkEvidence | null {
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as { prUrl?: unknown }).prUrl;
  if (typeof url !== "string" || !/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/.test(url)) {
    return null;
  }
  return { kind: "pr", url, title: "", atMs };
}
