import { GITHUB_API_BASE } from "@/lib/github-api";
import { parseFixNote, type FixNote } from "@/lib/feedback/fix-note";

/**
 * The design note of one pull request, read straight from GitHub — for the
 * moment a run closes, before the fix ledger has looked at the PR. Never
 * throws: no token, no PR or no section all read as "no note".
 */
export async function fetchFixNote(prUrl: string, token: string | null): Promise<FixNote | null> {
  const m = prUrl.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
  if (!m || !token) return null;
  try {
    const res = await fetch(`${GITHUB_API_BASE}/repos/${m[1]}/${m[2]}/pulls/${m[3]}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = ((await res.json()) as { body?: string | null }).body ?? null;
    return parseFixNote(body);
  } catch {
    return null;
  }
}
