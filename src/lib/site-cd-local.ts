/**
 * Box-local path probe for register-site.sh — no DB / GitHub I/O.
 * Used by site-cd-register and by tests that must not load DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";

export type RegisterSiteGate =
  "cloud-builder-private" | "auto-disabled" | "missing-script" | "missing-key" | "script-failed";

/** Studio DEV_ROOT — prefer the always-on box checkout over a laptop path. */
export function studioDevRoot(): string {
  if (process.env.LOKI_BOX_DEV_ROOT?.trim()) {
    return process.env.LOKI_BOX_DEV_ROOT.trim();
  }
  if (process.env.DEV_ROOT?.trim()) return process.env.DEV_ROOT.trim();
  // Production loki-app runs as ubuntu; durable clones live here.
  const ubuntuDev = "/home/ubuntu/dev";
  try {
    if (fs.existsSync(ubuntuDev)) return ubuntuDev;
  } catch {
    /* empty */
  }
  return path.join(os.homedir(), "dev");
}

export function studioRepoRoot(): string {
  if (process.env.LOKI_REPO_ROOT?.trim()) {
    return process.env.LOKI_REPO_ROOT.trim();
  }
  return path.join(studioDevRoot(), "loki");
}

function registerScriptCandidates(): string[] {
  if (process.env.LOKI_REGISTER_SITE_SCRIPT?.trim()) {
    return [process.env.LOKI_REGISTER_SITE_SCRIPT.trim()];
  }
  // Prefer the /opt release copy so Register site runs the just-deployed script.
  // Durable /home/ubuntu/dev/loki can lag after Deploy and still refuse
  // "already exists" while main is already idempotent. apps.conf writes still
  // go to LOKI_REPO_ROOT via the script's own MANIFEST resolution.
  return [
    "/opt/loki/app/scripts/hetzner/register-site.sh",
    path.join(studioRepoRoot(), "scripts/hetzner/register-site.sh"),
    path.join(process.cwd(), "scripts/hetzner/register-site.sh"),
  ];
}

export function resolveRegisterScriptPath(): string | null {
  for (const p of registerScriptCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* empty */
    }
  }
  return null;
}

function deployKeyCandidates(): string[] {
  const out: string[] = [];
  if (process.env.DEPLOY_KEY_PATH?.trim()) out.push(process.env.DEPLOY_KEY_PATH.trim());
  // The running user's own key. loki-app runs as `ubuntu`, so on the box this
  // already is /home/ubuntu; on a laptop it is that person's home. A different
  // user sets DEPLOY_KEY_PATH above — the documented SSOT (_box-env.sh). There
  // used to be two more literals here naming one specific laptop user and the
  // box user by path; both were this same candidate spelled for one person.
  out.push(path.join(os.homedir(), ".ssh/loki_ci_deploy"));
  return [...new Set(out)];
}

export function resolveDeployKeyPath(): string | null {
  for (const p of deployKeyCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* empty */
    }
  }
  return null;
}

export type RegisterSiteLocalProbe = {
  ok: boolean;
  gate: Exclude<RegisterSiteGate, "cloud-builder-private" | "script-failed"> | null;
  scriptPath: string | null;
  deployKeyPath: string | null;
  scriptCandidates: string[];
  keyCandidates: string[];
  reason: string | null;
};

/** Why auto-register can or cannot run in this process (no eligibility check). */
export function probeRegisterSiteLocally(): RegisterSiteLocalProbe {
  const scriptCandidates = registerScriptCandidates();
  const keyCandidates = deployKeyCandidates();
  if (process.env.LOKI_SITE_CD_AUTO === "0") {
    return {
      ok: false,
      gate: "auto-disabled",
      scriptPath: resolveRegisterScriptPath(),
      deployKeyPath: resolveDeployKeyPath(),
      scriptCandidates,
      keyCandidates,
      reason:
        "LOKI_SITE_CD_AUTO=0 — auto-register disabled. Unset it (or set to 1) on the studio box, or run the register command manually.",
    };
  }
  const scriptPath = resolveRegisterScriptPath();
  const deployKeyPath = resolveDeployKeyPath();
  if (!scriptPath) {
    return {
      ok: false,
      gate: "missing-script",
      scriptPath: null,
      deployKeyPath,
      scriptCandidates,
      keyCandidates,
      reason: `register-site.sh not found in this process (looked in: ${scriptCandidates.join(", ")}). Keep a durable checkout at ${studioRepoRoot()} on main, or set LOKI_REPO_ROOT / LOKI_REGISTER_SITE_SCRIPT.`,
    };
  }
  if (!deployKeyPath) {
    return {
      ok: false,
      gate: "missing-key",
      scriptPath,
      deployKeyPath: null,
      scriptCandidates,
      keyCandidates,
      reason: `Deploy key not readable in this process (looked in: ${keyCandidates.join(", ")}). On the studio box install it as /home/ubuntu/.ssh/loki_ci_deploy (chmod 600) or set DEPLOY_KEY_PATH — same key new-site.sh pipes into gh secret set.`,
    };
  }
  return {
    ok: true,
    gate: null,
    scriptPath,
    deployKeyPath,
    scriptCandidates,
    keyCandidates,
    reason: null,
  };
}

/** Studio box can auto-register when the trusted script and deploy key exist. */
export function canRunRegisterSiteLocally(): boolean {
  return probeRegisterSiteLocally().ok;
}
