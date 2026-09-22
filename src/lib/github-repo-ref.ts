/**
 * Reading a stored git URL, and saying what GitHub answered about it.
 *
 * Kept apart from the cron route so it is testable with no network and no
 * database: the parsing is where the edge cases live (ssh remotes, a trailing
 * `.git`, a deep link to a file), and those deserve a test that does not need
 * a GitHub token to run.
 */

export type RepoRef = { owner: string; repo: string; slug: string };

/**
 * Pull `owner/repo` out of a stored URL, or null when it is not a GitHub repo.
 *
 * Accepts the forms that actually appear in the column: an https URL, an ssh
 * remote, with or without `.git`, with or without extra path segments. A
 * GitLab or self-hosted URL returns null on purpose — this checker speaks to
 * GitHub's API and must not pretend to have an opinion about anything else.
 */
export function parseGithubRepo(gitUrl: string | null | undefined): RepoRef | null {
  if (!gitUrl) return null;
  const trimmed = gitUrl.trim();
  if (trimmed === "") return null;

  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s?#]+)/i.exec(trimmed) ??
    /^git@github\.com:([^/\s]+)\/([^/\s?#]+)/i.exec(trimmed);
  if (!match) return null;

  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/i, "");
  if (owner === "" || repo === "") return null;
  return { owner, repo, slug: `${owner}/${repo}` };
}

/**
 * What one lookup found.
 *
 * `moved` and `gone` are deliberately separate, and keeping them separate is
 * the entire point of this checker. GitHub redirects a renamed repository and
 * hands back its new `full_name`, so a move is a fact Loki can act on without
 * asking anybody. A 404 is not — the repo was deleted, or made private, or
 * never existed, and no amount of retrying turns that into an answer.
 *
 * `unchecked` is the third state that stops the other two from lying. A dead
 * token or a network blip must never be recorded as "healthy"; a checker whose
 * failure mode looks like a pass is worse than no checker, because it also
 * suppresses the question.
 */
export type RepoStatus =
  | { state: "ok"; slug: string }
  | { state: "moved"; slug: string; newSlug: string }
  | { state: "gone"; slug: string }
  | { state: "unchecked"; slug: string; reason: string };

/** Ask GitHub about one repo. Never throws — a failure is an `unchecked`. */
export async function checkRepo(
  ref: RepoRef,
  token: string,
  timeoutMs = 8000,
): Promise<RepoStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) return { state: "gone", slug: ref.slug };
    if (res.status === 401 || res.status === 403) {
      // The token is dead or rate-limited. Everything this tick is unknown,
      // not fine — see the note on `unchecked` above.
      return { state: "unchecked", slug: ref.slug, reason: `github returned ${res.status}` };
    }
    if (!res.ok) {
      return { state: "unchecked", slug: ref.slug, reason: `github returned ${res.status}` };
    }

    const body = (await res.json()) as { full_name?: unknown };
    const fullName = typeof body.full_name === "string" ? body.full_name : null;
    if (!fullName) {
      return { state: "unchecked", slug: ref.slug, reason: "no full_name in response" };
    }
    // GitHub followed a rename redirect for us: the name we asked for is not
    // the name we got back.
    if (fullName.toLowerCase() !== ref.slug.toLowerCase()) {
      return { state: "moved", slug: ref.slug, newSlug: fullName };
    }
    return { state: "ok", slug: ref.slug };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { state: "unchecked", slug: ref.slug, reason };
  } finally {
    clearTimeout(timer);
  }
}
