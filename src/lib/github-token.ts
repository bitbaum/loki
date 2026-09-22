import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { GITHUB_API_BASE } from "@/lib/github-api";

/**
 * OAuth access token of the user's linked GitHub account, or null when no
 * GitHub account is linked. Extracted after the same query appeared in three
 * routes (github/repos, bulk-from-github, create-with-github) — rule of three.
 */
export async function getGithubToken(userId: string): Promise<string | null> {
  const row = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "github")),
    columns: { access_token: true },
  });
  return row?.access_token ?? null;
}

/**
 * Does the stored GitHub token still work?
 *
 * ASK, don't assume — the same rule `getOrangeCatLink` follows, for the same
 * reason. A row in `accounts` proves somebody once connected GitHub; it says
 * nothing about whether the token still works. GitHub tokens do not expire on
 * a clock, so `expires_at` is null and there is no refresh flow: the only way
 * to know is to ask.
 *
 * This matters because the GitHub link is NOT sign-in only, which the settings
 * page used to claim. It carries `repo` scope — full read/write on private
 * repositories — and Loki acts through it in six places: /api/github/repos,
 * projects/[id]/enrich, bulk-from-github, project-dossier, github-org-token
 * and reap-evidence. If the token is revoked, all six break silently while the
 * page shows "Connected" in green. That is the five-silent-days failure the
 * OrangeCat check was written to end, and GitHub was left out of it.
 *
 * `/user` is the cheapest authenticated call GitHub offers and costs one
 * request against a 5000/hour budget.
 */
export async function githubTokenWorks(userId: string): Promise<boolean> {
  const token = await getGithubToken(userId);
  if (!token) return false;
  try {
    const res = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    });
    // 401/403 = the credential is refused. Anything else (including a 5xx or a
    // rate-limit) is GitHub having a moment, not evidence the link is dead —
    // reporting "reconnect" on a blip would train the operator to ignore it.
    return res.status !== 401 && res.status !== 403;
  } catch {
    // Network error or timeout: unknown, not broken. Same reasoning.
    return true;
  }
}
