/**
 * Every fleet package onto npm, from a phone.
 *
 * Releases themselves need nothing from anyone: a package's publish.yml
 * publishes a merged version bump through npm Trusted Publishing, with no
 * token. What npm will not let a workflow do is create a package — a FIRST
 * version — or link one to GitHub; that takes the account. On 2026-10-17
 * that meant four packages sitting unpublished while the owner, on a phone,
 * was walked through an npm form and a GitHub form by hand.
 *
 * Now the owner pastes one npm key into Loki (the panel on /packages, whose
 * settings are SSOT in src/config/npm-publishing.ts), and Loki, for every
 * catalogue package whose repository the owner can push to and whose name
 * npm does not know yet:
 *
 *   1. writes the key into the repository as the Actions secret publish.yml
 *      reads (GitHub's sealed-box format, libsodium — the format GitHub's
 *      own docs use),
 *   2. starts publish.yml, which publishes the first version with the key and
 *      then links itself as trusted publisher, so later releases need none.
 *
 * The 15-minute package cron runs the same for a package registered later,
 * so a new package reaches npm without anyone asking — until the key expires,
 * when the panel asks for a new one.
 */
import { GITHUB_API_BASE } from "@/lib/github-api";
import { NPM_KEY_SECRET, PUBLISH_WORKFLOW } from "@/config/npm-publishing";
import { getNpmPublishKey, recordNpmPublishAttempts } from "@/db/queries/npm-publish-keys";
import { openSecret } from "@/lib/secret-box";
import { getPackageCatalogue } from "./catalogue";
import type { CataloguePackage } from "./catalogue-parse";
import {
  keyUsable,
  npmHasPackage,
  recentlyStarted,
  sealForGithub,
  type FetchLike,
  type FirstPublishOutcome,
  type FirstPublishResult,
} from "./npm-publish-rules";
import { resolveReleaseAccess } from "./release-access";

export type { FirstPublishOutcome, FirstPublishResult } from "./npm-publish-rules";

const TIMEOUT_MS = 8_000;

function githubClient(token: string, fetchImpl: FetchLike) {
  const call = (path: string, init?: RequestInit) =>
    fetchImpl(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  return {
    /** The repository's package.json on its default branch, or null. */
    async manifest(
      slug: string,
      ref: string,
    ): Promise<{ name?: unknown; private?: unknown } | null> {
      const res = await call(
        `/repos/${slug}/contents/package.json?ref=${encodeURIComponent(ref)}`,
        {
          headers: { Accept: "application/vnd.github.raw+json" },
        },
      );
      if (!res.ok) return null;
      return (await res.json().catch(() => null)) as { name?: unknown; private?: unknown } | null;
    },
    async hasWorkflow(slug: string, ref: string): Promise<boolean> {
      const res = await call(
        `/repos/${slug}/contents/.github/workflows/${PUBLISH_WORKFLOW}?ref=${encodeURIComponent(ref)}`,
      );
      return res.ok;
    },
    async putSecret(slug: string, name: string, value: string): Promise<void> {
      const res = await call(`/repos/${slug}/actions/secrets/public-key`);
      if (!res.ok) throw new Error(`GitHub would not give the secret key (${res.status})`);
      const pk = (await res.json()) as { key: string; key_id: string };
      const put = await call(`/repos/${slug}/actions/secrets/${name}`, {
        method: "PUT",
        body: JSON.stringify({
          encrypted_value: await sealForGithub(pk.key, value),
          key_id: pk.key_id,
        }),
      });
      if (!put.ok) throw new Error(`GitHub refused the secret (${put.status})`);
    },
    async dispatch(slug: string, ref: string): Promise<void> {
      const res = await call(`/repos/${slug}/actions/workflows/${PUBLISH_WORKFLOW}/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref }),
      });
      if (!res.ok) throw new Error(`GitHub would not start ${PUBLISH_WORKFLOW} (${res.status})`);
    },
  };
}

/**
 * Start the first publish of every catalogue package that npm does not know
 * yet and this person owns. Never throws; one package's trouble is its row.
 */
export async function startFirstPublishes(input: {
  userId: string;
  key: string;
  packages: CataloguePackage[];
  attempts: Record<string, string>;
  now: Date;
  fetchImpl?: FetchLike;
}): Promise<FirstPublishResult[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const results: FirstPublishResult[] = [];
  for (const pkg of input.packages) {
    if (!pkg.repo) continue;
    const row = (outcome: FirstPublishOutcome, name = pkg.name, detail?: string) =>
      results.push({ name, repo: pkg.repo as string, outcome, ...(detail ? { detail } : {}) });
    try {
      const access = await resolveReleaseAccess(input.userId, pkg);
      if (!access.ok) {
        row("not-yours");
        continue;
      }
      const gh = githubClient(access.token, fetchImpl);
      const manifest = await gh.manifest(access.ref.slug, access.defaultBranch);
      const name = typeof manifest?.name === "string" ? manifest.name : pkg.name;
      if (manifest?.private === true) {
        row("private", name);
        continue;
      }
      const known = await npmHasPackage(name, fetchImpl);
      if (known === null) {
        row("failed", name, "Could not reach npm.");
        continue;
      }
      if (known) {
        row("on-npm", name);
        continue;
      }
      if (recentlyStarted(input.attempts[name], input.now)) {
        row("waiting", name);
        continue;
      }
      if (!(await gh.hasWorkflow(access.ref.slug, access.defaultBranch))) {
        row("no-workflow", name);
        continue;
      }
      await gh.putSecret(access.ref.slug, NPM_KEY_SECRET, input.key);
      await gh.dispatch(access.ref.slug, access.defaultBranch);
      row("started", name);
    } catch (err) {
      row("failed", pkg.name, err instanceof Error ? err.message : "Something went wrong.");
    }
  }
  return results;
}

export type FirstPublishRun =
  | { ok: true; results: FirstPublishResult[] }
  | { ok: false; reason: "no-key" | "expired" | "unreadable" };

/**
 * One person's pass with the key they saved: the panel's "Publish now" and
 * the package cron both call this. Records which first publishes it started,
 * so the next pass leaves them to finish.
 */
export async function runFirstPublishes(
  userId: string,
  now = new Date(),
): Promise<FirstPublishRun> {
  const row = await getNpmPublishKey(userId);
  if (!row) return { ok: false, reason: "no-key" };
  if (!keyUsable(row.expiresAt, now)) return { ok: false, reason: "expired" };
  const key = openSecret(row.sealed);
  if (!key) return { ok: false, reason: "unreadable" };
  const { packages } = await getPackageCatalogue();
  const results = await startFirstPublishes({
    userId,
    key,
    packages,
    attempts: row.attempts,
    now,
  });
  await recordNpmPublishAttempts(
    userId,
    results.filter((r) => r.outcome === "started").map((r) => r.name),
    now,
  );
  return { ok: true, results };
}
