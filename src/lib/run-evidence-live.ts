/**
 * Repo-side evidence for the run a person is WATCHING, found while it runs.
 *
 * The reaper looks for a pull request only after a run has timed out, and the
 * fix ledger only after a run has closed — and then only if the handoff names
 * the pull request. So for the whole time an agent was working, the page had
 * no fact from GitHub to show, although the branch and the pull request were
 * usually there six minutes in. This asks GitHub for that fact on the page's
 * behalf, at most once a minute per run, and records it on the run
 * (payload.evidence, the key the reaper writes) so every later reader — the
 * ledger, the chat card, Control — follows the same pull request.
 *
 * Only for a run someone has open: nothing here runs on a timer
 * (scripts/test/no-free-background-ai.ts holds every scheduled path to none).
 */
import { fetchPrHeadRef, findRepoWorkEvidence } from "@/lib/github-evidence";
import type { RepoWorkEvidence } from "@/lib/repo-evidence";
import { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";
import { getRepoWriteToken, lokiKeepsCode } from "@/lib/github-org-token";
import { findCodeCustodyByGitUrl } from "@/db/queries/user-projects";
import { replaceRunEvidence, stampRunEvidence } from "@/db/queries/orchestration-runs";
import { refBelongsToRun, runBranches, runEvidenceUntilMs } from "@/lib/run-branches";

/**
 * The token a read of this repository goes out with — the same picker as the
 * fix ledger: the server's token for code Loki keeps or for accounts entitled
 * to fleet infrastructure, the person's own otherwise. Null: nobody can ask.
 */
export async function repoTokenFor(userId: string, gitUrl: string): Promise<string | null> {
  const custody = await findCodeCustodyByGitUrl(userId, gitUrl).catch(() => null);
  const picked = await getRepoWriteToken(userId, {
    lokiKept: lokiKeepsCode({ gitUrl, codeCustody: custody }),
  }).catch(() => null);
  return picked?.token ?? null;
}

/** GitHub is asked about one run at most this often. */
export const EVIDENCE_LOOK_MS = 60_000;

const lastLook = new Map<string, number>();

export async function findLiveRunEvidence(
  userId: string,
  run: { id: string; startedAt: Date; finishedAt?: Date | null; payload: unknown },
  gitUrl: string | null | undefined,
  now = Date.now(),
): Promise<RepoWorkEvidence | null> {
  const known = normalizeRepoWorkEvidence((run.payload as { evidence?: unknown })?.evidence);
  const own = runBranches(run);
  // Recorded with its branch: the run's only if the branch is one of its own.
  if (known?.branch) return refBelongsToRun(known.branch, own) ? known : null;
  // A push records its ref in its address.
  if (known?.kind === "push") {
    const ref = known.url.match(/\/tree\/(.+)$/)?.[1] ?? null;
    return ref && refBelongsToRun(decodeURIComponent(ref), own) ? known : null;
  }
  if (!gitUrl) return null;
  const at = lastLook.get(run.id) ?? 0;
  if (now - at < EVIDENCE_LOOK_MS) return null;
  lastLook.set(run.id, now);
  if (lastLook.size > 500) {
    // Bounded: forget the oldest looks rather than grow with every run ever watched.
    for (const key of [...lastLook.keys()].slice(0, 250)) lastLook.delete(key);
  }
  try {
    const token = await repoTokenFor(userId, gitUrl);
    if (!token) return null;
    if (known) {
      // A pull request recorded before evidence carried its branch was found
      // by time alone (run 70d1a78d was given loki#1636 that way). Ask GitHub
      // once whose branch it is: the run's keeps it, anybody else's is
      // removed so no page or ledger follows it again.
      const head = await fetchPrHeadRef(known.url, token);
      if (head === undefined) return null;
      if (head && refBelongsToRun(head, own)) {
        const confirmed = { ...known, branch: head };
        await replaceRunEvidence(run.id, userId, confirmed).catch(() => undefined);
        return confirmed;
      }
      await replaceRunEvidence(run.id, userId, null).catch(() => undefined);
    }
    const found = await findRepoWorkEvidence(
      gitUrl,
      token,
      run.startedAt.getTime(),
      own,
      runEvidenceUntilMs(run),
    );
    if (!found) return null;
    await (known ? replaceRunEvidence : stampRunEvidence)(run.id, userId, found).catch(
      () => undefined,
    );
    return found;
  } catch {
    return null;
  }
}
