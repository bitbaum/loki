/**
 * Box-runner workspace prep — make a dispatched project runnable on the box.
 *
 * A dispatch carries the LAPTOP dir (e.g. /home/g/dev/loki), which doesn't
 * exist on the always-on box. This resolves a box-local dir, clones the project
 * on demand from its gitUrl, and pre-trusts it for claude so the agent launches
 * unattended instead of hanging at the trust-folder gate.
 *
 * What to clone and with which token comes from the control plane
 * (`/api/control/workspace-source`, fetched by the runner with its own token:
 * desktop/src/main/workspace-source.ts). Until 2026-10-20 this module read
 * `user_projects` itself, which is why the runner carried the production
 * DATABASE_URL, and it cloned with the org GITHUB_TOKEN from its own
 * environment. It now reads no database and holds no token of its own
 * (docs/architecture/private-builders.md).
 *
 * Loaded ONLY by the box-runner (LOKI_BOX_PREPARE=true), via dynamic import
 * from pty-runtime — keeps git out of the desktop Electron bundle.
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// Path derivation lives in the pure module so the poller (transcript lookups)
// and this file (cloning) can never disagree about where a project is.
import {
  BOX_DEV_ROOT as DEV_ROOT,
  sanitizeWorkspaceKey as sanitizeKey,
} from "@/lib/agent-execution/box-workspace-path";

// Re-exported for existing importers; the implementation is the shared pure
// module so dispatch routing and workspace prep can never disagree.
export { normalizeGitHubCloneUrl } from "@/lib/git-url";
import { normalizeGitHubCloneUrl } from "@/lib/git-url";
import { ensureClaudeReady } from "@/lib/agent-execution/claude-prep";

/** What the control plane says a project is made of, for this account. */
export type WorkspaceSource = {
  /** A cloneable GitHub URL, or null when there is nothing to clone. */
  gitUrl: string | null;
  /** A token that may read and write that repository, for this run only. */
  token: string | null;
};

/**
 * Auth via a per-invocation extraheader instead of embedding the token in the
 * remote URL. An embedded token persists in .git/config forever and leaks via
 * `git remote -v`, logs, and any agent that cats the config (observed: every
 * box workspace remote carried a plaintext OAuth token). The header exists
 * only for the lifetime of the command — same pattern actions/checkout uses.
 */
function authArgs(token: string | null): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

/** Strip a legacy embedded credential from origin so old clones stop leaking. */
function scrubRemoteUrl(boxDir: string): void {
  try {
    const url = execFileSync("git", ["-C", boxDir, "remote", "get-url", "origin"], {
      timeout: 15_000,
    })
      .toString()
      .trim();
    const clean = url.replace(/^https:\/\/[^@/]+@/, "https://");
    if (clean !== url)
      execFileSync("git", ["-C", boxDir, "remote", "set-url", "origin", clean], {
        timeout: 15_000,
      });
  } catch {
    // No origin (empty scaffold dir) — nothing to scrub.
  }
}

function syncExistingClone(boxDir: string, token: string | null): void {
  if (!fs.existsSync(path.join(boxDir, ".git"))) return;
  scrubRemoteUrl(boxDir);
  const auth = authArgs(token);
  try {
    execFileSync("git", [...auth, "-C", boxDir, "fetch", "--depth", "50", "origin"], {
      stdio: "inherit",
      timeout: 120_000,
    });
    execFileSync("git", [...auth, "-C", boxDir, "pull", "--ff-only"], {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (e) {
    console.warn(
      `[box-prepare] git sync failed for ${boxDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Resolve (and if needed create/clone) the box-local dir for a dispatched project. */
export async function ensureBoxWorkspace(
  tab: string,
  requestedDir: string,
  source: WorkspaceSource | null,
): Promise<string> {
  if (requestedDir && fs.existsSync(requestedDir)) {
    ensureClaudeReady(requestedDir);
    return requestedDir;
  }

  const boxDir = path.join(DEV_ROOT, sanitizeKey(tab));
  if (fs.existsSync(boxDir)) {
    syncExistingClone(boxDir, source?.token ?? null);
    ensureClaudeReady(boxDir);
    return boxDir;
  }

  const gitUrlRaw = source?.gitUrl?.trim() ?? "";
  const gitUrl = gitUrlRaw ? normalizeGitHubCloneUrl(gitUrlRaw) : null;
  fs.mkdirSync(DEV_ROOT, { recursive: true });

  if (gitUrl) {
    console.log(`[box-prepare] cloning ${tab} ← ${gitUrl} → ${boxDir}`);
    // Clean URL in .git/config; the token travels only in the ephemeral header.
    execFileSync(
      "git",
      [...authArgs(source?.token ?? null), "clone", "--depth", "50", gitUrl, boxDir],
      { stdio: "inherit", timeout: 180_000 },
    );
  } else if (requestedDir) {
    // The dispatch named a REAL directory that only exists on another machine
    // and there is no gitUrl to clone from. Inventing an empty dir here would
    // let the agent "work" on a phantom workspace and report success against
    // nothing (2026-07-14: a BiasLens dispatch routed to the box bootstrapped
    // a fresh Next app in an empty dir while the real scaffold sat on the
    // laptop). Fail loud so the ack records the truth and the operator sees a
    // failed command instead of confident garbage.
    throw new Error(
      `workspace for "${tab}" is not materializable on this builder: ${requestedDir} does not exist here and the project has no cloneable GitHub gitUrl${gitUrlRaw ? ` (unsupported URL: ${gitUrlRaw})` : ""}. Dispatch it to the machine that has the directory, or link a GitHub repo.`,
    );
  } else {
    console.log(
      `[box-prepare] no GitHub gitUrl for "${tab}"${gitUrlRaw ? ` (unsupported URL: ${gitUrlRaw})` : ""}; creating empty ${boxDir}`,
    );
    fs.mkdirSync(boxDir, { recursive: true });
  }

  ensureClaudeReady(boxDir);
  return boxDir;
}

/** The branch a run works on: one per run, named so it is obviously Loki's. */
export function runBranchName(runId: string): string {
  return `loki/run-${runId
    .replace(/[^0-9a-zA-Z]/g, "")
    .slice(0, 8)
    .toLowerCase()}`;
}

function defaultRemoteBranch(dir: string): string {
  try {
    const ref = execFileSync(
      "git",
      ["-C", dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      {
        timeout: 15_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .toString()
      .trim();
    if (ref.startsWith("origin/")) return ref.slice("origin/".length);
  } catch {
    // origin/HEAD unset (old clone): try the usual names below.
  }
  for (const name of ["main", "master"]) {
    try {
      execFileSync(
        "git",
        ["-C", dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`],
        {
          timeout: 15_000,
          stdio: "ignore",
        },
      );
      return name;
    } catch {
      // not this one
    }
  }
  return "main";
}

/**
 * Put a box checkout on a FRESH branch off the remote default branch before a
 * run starts. The checkout is shared by every run of the project, so whatever
 * branch the last run (or a person) left it on is not this run's starting
 * point: the 2026-10-21 Substrata /chat run began on fix/atlas-title-hierarchy.
 * Uncommitted leftovers are stashed with a message naming where they came
 * from, never discarded. Best effort: a failure leaves the checkout as it was
 * and says so in the runner log.
 */
export function startRunBranch(dir: string, runId: string, token: string | null): string | null {
  // A worktree (`.git` is a file) already has its own per-run branch.
  const dotGit = path.join(dir, ".git");
  if (!fs.existsSync(dotGit) || !fs.statSync(dotGit).isDirectory()) return null;
  const git = (args: string[], timeout = 60_000) =>
    execFileSync("git", ["-C", dir, ...args], { timeout, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  const branch = runBranchName(runId);
  try {
    const base = defaultRemoteBranch(dir);
    execFileSync("git", [...authArgs(token), "-C", dir, "fetch", "--depth", "50", "origin", base], {
      timeout: 120_000,
      stdio: "inherit",
    });
    if (git(["status", "--porcelain"])) {
      const was = git(["rev-parse", "--abbrev-ref", "HEAD"]);
      git([
        "stash",
        "push",
        "--include-untracked",
        "-m",
        `loki: left on ${was} before run ${runId}`,
      ]);
    }
    git(["checkout", "-B", branch, `origin/${base}`]);
    return branch;
  } catch (e) {
    console.warn(
      `[box-prepare] could not start ${branch} in ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}
