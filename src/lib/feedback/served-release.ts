/**
 * Is a merged change live? Ask the site, not the workflow runs.
 *
 * The ledger decided "deploying / deploy failed / live" from the workflow
 * runs labelled with the merge commit (fix-shipping.ts pickDeployRun). On
 * this fleet that label is wrong in four ways, all seen on 2026-11-12:
 *
 *  - a Deploy run started by `workflow_run` is labelled with main's tip at
 *    the moment it starts, not the commit it ships: run 2902 was labelled
 *    with #1645's merge and finished green while the box served #1643's, so
 *    #1643 read "Deploying" for good and #1645 read Live before it was;
 *  - a merge the sweep batches under a later deploy carries no Deploy run
 *    of its own (#1638, #1641, #1643, #1644);
 *  - OrangeCat's deploy workflow is named CD and started by dispatch, so
 *    the name match never finds it and its changes could never read Live;
 *  - a merge commit with more than twenty runs loses its Deploy run off the
 *    page that is read.
 *
 * Every fleet site publishes what it runs at /.well-known/fleet-release.json
 * ({ repo, commit, createdAt }, staged by scripts/hetzner/stage-release-
 * receipt.sh). A merge is live when the served commit is the merge or comes
 * after it. That is one public read of the site and one GitHub compare, and
 * it does not care how the deploy was started or what it was called.
 *
 * It only ever upgrades a merged change to live. A site with no receipt, a
 * receipt for another repository or a compare that cannot be read changes
 * nothing: the workflow-run verdict stands.
 */
import { isPrivateAddress } from "@/lib/private-address";
import { normalizeWebsite } from "@/lib/website-brief";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";

export const RELEASE_RECEIPT_PATH = "/.well-known/fleet-release.json";
const RECEIPT_TIMEOUT_MS = 5_000;
const RECEIPT_MAX_BYTES = 64_000;

export type ServedRelease = {
  /** "owner/name" as the receipt states it. */
  repo: string;
  commit: string;
  /** ISO — when that release was built, when the receipt says. */
  createdAt: string | null;
  /** The receipt's own address. */
  url: string;
};

/** Does the served commit contain the merge? Null: could not tell. */
export type ServedRelation = "contains" | "missing" | null;

/** Pure: a receipt body → what the ledger reads, or null when it is not one. */
export function parseServedRelease(body: unknown, url: string): ServedRelease | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const repo = typeof b.repo === "string" ? b.repo.trim() : "";
  const commit = typeof b.commit === "string" ? b.commit.trim().toLowerCase() : "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(commit)) return null;
  const createdAt =
    typeof b.createdAt === "string" && Number.isFinite(Date.parse(b.createdAt))
      ? b.createdAt
      : null;
  return { repo, commit, createdAt, url };
}

/**
 * Pure: GitHub's `compare/<merge>...<served>` status → the relation. "ahead"
 * and "identical" mean the served commit is the merge or has it in its
 * history; "behind" and "diverged" mean the site runs something without it.
 */
export function relationFromCompare(status: string | null | undefined): ServedRelation {
  if (status === "identical" || status === "ahead") return "contains";
  if (status === "behind" || status === "diverged") return "missing";
  return null;
}

/** The ledger states a served receipt can settle: merged, and not yet live. */
export function awaitsServedRelease(fix: FixShipping): boolean {
  return (
    Boolean(fix.pr?.mergeSha) &&
    (fix.state === FIX_SHIP_STATE.MERGED ||
      fix.state === FIX_SHIP_STATE.DEPLOYING ||
      fix.state === FIX_SHIP_STATE.DEPLOY_FAILED)
  );
}

/**
 * Pure: the ledger, corrected by what the site serves. Live when the served
 * commit contains the merge; unchanged in every other case. A deploy run
 * that failed on the merge commit is kept as `ownDeploy`, so a reader can
 * still say how it went live.
 */
export function applyServedRelease(
  fix: FixShipping,
  served: ServedRelease | null,
  relation: ServedRelation,
  repoFullName: string,
): FixShipping {
  if (!served || relation !== "contains" || !awaitsServedRelease(fix)) return fix;
  if (served.repo.toLowerCase() !== repoFullName.toLowerCase()) return fix;
  const failed = fix.state === FIX_SHIP_STATE.DEPLOY_FAILED ? fix.deploy : null;
  return {
    ...fix,
    state: FIX_SHIP_STATE.DEPLOYED,
    deploy: {
      url: served.url,
      name: "the served release",
      conclusion: "success",
      status: "completed",
      at: served.createdAt,
    },
    liveVia: "served_release",
    ...(failed
      ? { ownDeploy: { url: failed.url, name: failed.name, conclusion: failed.conclusion } }
      : {}),
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type LookupLike = (host: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupLike = async (host) => {
  const dns = await import("node:dns/promises");
  return dns.lookup(host, { all: true, verbatim: true });
};

/**
 * Read a site's release receipt. The address is a project's own live URL,
 * which a person typed, so it gets the guard a stranger's address gets: a
 * public domain on the default port (normalizeWebsite), every DNS answer
 * public, no redirect followed, a short timeout and a small body. Never
 * throws; null when there is no receipt to read.
 */
export async function fetchServedRelease(
  liveUrl: string | null | undefined,
  deps: { fetchImpl?: FetchLike; lookup?: LookupLike } = {},
): Promise<ServedRelease | null> {
  const site = liveUrl ? normalizeWebsite(liveUrl) : null;
  if (!site) return null;
  try {
    const url = new URL(RELEASE_RECEIPT_PATH, new URL(site).origin);
    if (url.protocol !== "https:") return null;
    const answers = await (deps.lookup ?? defaultLookup)(url.hostname);
    if (!answers.length || answers.some((a) => isPrivateAddress(a.address))) return null;
    const res = await (deps.fetchImpl ?? fetch)(url.href, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RECEIPT_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > RECEIPT_MAX_BYTES) return null;
    return parseServedRelease(JSON.parse(text), url.href);
  } catch {
    return null;
  }
}
