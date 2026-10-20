/**
 * Where a dispatched project actually lives on THIS runner — the one decision,
 * in one place.
 *
 * A dispatch carries the founder's LAPTOP path (`/home/g/dev/solon`). On the
 * laptop that path exists and is used as-is; on the always-on box it does not,
 * and the work happens in a box-local clone (`~/dev/solon`).
 *
 * `ensureBoxWorkspace` has always made that call, but it made it *privately*:
 * the resolved directory never escaped `launchAgentPty`, so every other part of
 * the runner that needed to know where the agent actually ran kept using the
 * unresolved laptop path. Two things silently broke as a result — both of them
 * lookups into `~/.claude/projects/<slug-of-dir>`, which on the box resolved to
 * a `-home-g-dev-*` slug that cannot exist there:
 *
 *   - Token accounting (#133/#145) tracked runs at the laptop path, found no
 *     transcript, and skipped forever. It wrote ZERO rows in its first day live.
 *   - `detectAuthFailure` read the same non-existent directory, so dead box
 *     credentials were undetectable — the exact failure its own comment warns
 *     about.
 *
 * Pure and dependency-free (fs/os/path only) so the poller can import it
 * statically without dragging `@/db` into the desktop bundle — the reason
 * `box-workspace.ts` is dynamically imported in the first place.
 */
import fs from "fs";
import os from "os";
import path from "path";

/** Where the box keeps its on-demand clones. */
export const BOX_DEV_ROOT = process.env.LOKI_BOX_DEV_ROOT || path.join(os.homedir(), "dev");

/**
 * A private builder's dev root on the box: `/home/lk-<short>/dev`, where
 * short is the first eight characters of the user id — the same derivation
 * scripts/hetzner/new-tenant.sh uses for the system user and the unit
 * instance (docs/architecture/private-builders.md). Pure, so the app can
 * write a truthful project path for a tenant without asking the box.
 */
export function tenantShortId(userId: string): string {
  return userId.slice(0, 8);
}
export function tenantDevRoot(userId: string): string {
  return `/home/lk-${tenantShortId(userId)}/dev`;
}
/** Any tenant's dev root, for a path written by one of them. */
export const TENANT_DEV_ROOT_RE = /^\/home\/lk-[0-9a-f]{8}\/dev(\/|$)/;

/** Directory-safe form of a project/tab name. */
export function sanitizeWorkspaceKey(tab: string): string {
  return (
    tab
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

/**
 * The directory this runner will actually use for `tab`.
 *
 * An existing `requestedDir` always wins — that is the laptop case, and it is
 * also what makes this safe to call on a non-box runner, where it is the
 * identity function. Otherwise the box-local clone path, whether or not the
 * clone exists yet: callers that only need the PATH (transcript lookups) must
 * agree with the caller that does the cloning, and waiting for the clone would
 * make them disagree during the first minute of a run.
 */
export function resolveRunnerWorkspaceDir(tab: string, requestedDir: string): string {
  if (requestedDir && fs.existsSync(requestedDir)) return requestedDir;
  return path.join(BOX_DEV_ROOT, sanitizeWorkspaceKey(tab));
}
