/**
 * The parts of npm-publish.ts that need no database: asking npm, sealing a
 * value for GitHub, and the timing rules. Pure or network-only, so
 * scripts/test/npm-publish.ts runs them without a database.
 */
import sodium from "libsodium-wrappers";
import { KEY_EXPIRY_MARGIN_MS, RETRY_AFTER_MS } from "@/config/npm-publishing";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const NPM_REGISTRY = "https://registry.npmjs.org";
const TIMEOUT_MS = 8_000;

export type FirstPublishOutcome =
  "started" | "on-npm" | "waiting" | "no-workflow" | "not-yours" | "private" | "failed";

export type FirstPublishResult = {
  /** The name the repository's package.json gives — what npm will list. */
  name: string;
  repo: string;
  outcome: FirstPublishOutcome;
  /** For "failed": what went wrong, in a sentence. */
  detail?: string;
};

/** `@bitbaum/x` → `@bitbaum%2Fx`, the registry's path form. */
function registryPath(name: string): string {
  return encodeURIComponent(name).replace(/^%40/, "@");
}

/** Does npm know this package at all? null when npm could not be asked. */
export async function npmHasPackage(
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean | null> {
  try {
    const res = await fetchImpl(`${NPM_REGISTRY}/${registryPath(name)}`, {
      method: "GET",
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

/** Whose key is this? The npm user, "rejected" (npm said no) or "unreachable". */
export async function npmKeyOwner(
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; user: string } | { ok: false; reason: "rejected" | "unreachable" }> {
  try {
    const res = await fetchImpl(`${NPM_REGISTRY}/-/whoami`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "rejected" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const body = (await res.json().catch(() => null)) as { username?: unknown } | null;
    return typeof body?.username === "string"
      ? { ok: true, user: body.username }
      : { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** A value sealed to a repository's Actions public key (base64 in, base64 out). */
export async function sealForGithub(publicKeyB64: string, value: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/** Is the key still worth using? Past its date (less a margin) it is not. */
export function keyUsable(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() - KEY_EXPIRY_MARGIN_MS > now.getTime();
}

/** Did Loki start this package's first publish recently enough to leave it be? */
export function recentlyStarted(attempt: string | undefined, now: Date): boolean {
  if (!attempt) return false;
  const at = Date.parse(attempt);
  return Number.isFinite(at) && now.getTime() - at < RETRY_AFTER_MS;
}
