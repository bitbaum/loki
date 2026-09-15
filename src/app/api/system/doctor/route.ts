import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { validateAgentToken } from "@/db/queries/agent-tokens";
import { getApiUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { APP_URL } from "@/config/brand";
import { checkTelemetryFreshness, humanizeAge } from "@/lib/telemetry-freshness";
import { runnerVersionStatus } from "@/lib/runner-version";
import { getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";

const execp = promisify(exec);

type DoctorStatus = "pass" | "warn" | "fail";
type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
};

function check(id: string, label: string, status: DoctorStatus, detail: string): DoctorCheck {
  return { id, label, status, detail };
}

async function shell(command: string, timeout = 5000): Promise<string> {
  const { stdout } = await execp(command, { timeout });
  return stdout.trim();
}

function readTokenFile(): string {
  const path = `${homedir()}/.config/loki/fleet-runner-token`;
  if (!existsSync(/*turbopackIgnore: true*/ path)) return "";
  return readFileSync(/*turbopackIgnore: true*/ path, "utf8").trim();
}

function readRunnerEnv(): Record<string, string> {
  // Fleet Runner writes runner.env; older installs wrote daemon.env. Prefer the
  // current name, fall back to the legacy file so existing machines keep working.
  const dir = `${homedir()}/.config/loki`;
  const path = existsSync(/*turbopackIgnore: true*/ `${dir}/runner.env`)
    ? `${dir}/runner.env`
    : `${dir}/daemon.env`;
  if (!existsSync(/*turbopackIgnore: true*/ path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(/*turbopackIgnore: true*/ path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
  }
  return out;
}

async function tableExists(name: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = ${name}
    limit 1
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    limit 1
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length > 0;
}

async function checkSystemdUnits(): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  // Session 4 of killing-the-bash-daemon: only the local Next.js prod wrapper
  // remains as a Loki systemd unit. Fleet Runner desktop is a regular
  // Electron app the user launches from their tray menu — it has no
  // systemd unit to probe (its process tree appears under app-fleet-
  // runner@.service if the user enabled systemd integration, but that's
  // an OS-level convenience, not a Loki surface).
  for (const unit of ["loki-app.service"]) {
    try {
      const [active, enabled] = await Promise.all([
        shell(`systemctl --user is-active ${unit}`).catch(() => "inactive"),
        shell(`systemctl --user is-enabled ${unit}`).catch(() => "disabled"),
      ]);
      out.push(
        check(
          `unit:${unit}`,
          unit,
          active === "active" && enabled === "enabled"
            ? "pass"
            : active === "active"
              ? "warn"
              : "fail",
          `${active}, ${enabled}`,
        ),
      );
    } catch (err) {
      out.push(
        check(`unit:${unit}`, unit, "fail", err instanceof Error ? err.message : String(err)),
      );
    }
  }

  const legacyUnits = await shell(
    "systemctl --user list-unit-files '*cockpit*' --no-legend --no-pager 2>/dev/null || true",
  ).catch(() => "");
  out.push(
    check(
      "legacy-units",
      "Legacy Cockpit units",
      legacyUnits ? "warn" : "pass",
      legacyUnits ? legacyUnits.split("\n").slice(0, 3).join("; ") : "No active unit files listed.",
    ),
  );
  return out;
}

async function checkClaudeHooks(): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  // Session 4 of killing-the-bash-daemon retired the bash bridge that the
  // Stop hook used to exec. The hook is now expected to be a no-op (or
  // absent) — Fleet Runner's embedded watcher (home/watcher.ts) detects the
  // status:ready transition by filesystem mtime and triggers dispatch via
  // its own TS module (desktop/src/main/dispatch.ts). A hook that still
  // points at the deleted bridge is broken; flag it.
  const stopHook = `${homedir()}/.claude/hooks/stop.sh`;
  const deadBridgeTarget = ".local/share/loki-beacon/agent-hook-bridge.sh";
  const stopExists = existsSync(/*turbopackIgnore: true*/ stopHook);
  const stopReferencesDeadBridge =
    stopExists &&
    readFileSync(/*turbopackIgnore: true*/ stopHook, "utf8").includes(deadBridgeTarget);
  out.push(
    check(
      "hooks",
      "Claude Stop hook",
      !stopReferencesDeadBridge ? "pass" : "fail",
      !stopExists
        ? "No stop.sh installed — Fleet Runner's filesystem watcher triggers dispatch instead."
        : stopReferencesDeadBridge
          ? "stop.sh still points at the retired bash bridge — rewrite to `exit 0` or remove the file entirely."
          : "stop.sh is a no-op (correct post-migration state).",
    ),
  );

  // Typed-prompt capture: without the UserPromptSubmit hook, prompts typed
  // directly into a Claude tab never reach /api/activity/capture, so Activity
  // only shows dispatched work. Fleet Runner installs it on startup
  // (desktop/src/main/capture-hook.ts); warn — not fail — because dispatch-only
  // setups work fine without it, they just under-report.
  const captureScript = `${homedir()}/.claude/hooks/loki-capture.sh`;
  const claudeSettingsPath = `${homedir()}/.claude/settings.json`;
  let captureRegistered = false;
  let legacyCaptureRegistered = false;
  try {
    const settings = JSON.parse(
      readFileSync(/*turbopackIgnore: true*/ claudeSettingsPath, "utf8"),
    ) as {
      hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const submitHooks = (settings.hooks?.UserPromptSubmit ?? []).flatMap(
      (entry) => entry.hooks ?? [],
    );
    captureRegistered = submitHooks.some(
      (h) => typeof h.command === "string" && h.command.includes("loki-capture.sh"),
    );
    // The June-era hook posts to localhost:3000 and silently drops every
    // prompt on a normal setup. If it is still registered the sensor LOOKS
    // wired but records nothing — the exact failure that went unnoticed for
    // two months. Fleet Runner ≥0.8.12 deregisters it on startup.
    legacyCaptureRegistered = submitHooks.some(
      (h) => typeof h.command === "string" && h.command.includes("fleet-user-prompt.sh"),
    );
  } catch {
    /* missing or unparseable settings.json → not registered */
  }
  const captureScriptExists = existsSync(/*turbopackIgnore: true*/ captureScript);
  const captureHealthy = captureRegistered && captureScriptExists && !legacyCaptureRegistered;
  out.push(
    check(
      "hooks-capture",
      "Claude prompt-capture hook",
      captureHealthy ? "pass" : "warn",
      captureHealthy
        ? "UserPromptSubmit hook installed — directly-typed prompts reach Activity."
        : legacyCaptureRegistered
          ? "Legacy fleet-user-prompt.sh is still registered — it posts to localhost and drops prompts. Restart Fleet Runner (≥0.8.12) to migrate to loki-capture.sh."
          : "Not installed — directly-typed Claude prompts won't appear in Activity. Start Fleet Runner (it installs the hook once a token is saved).",
    ),
  );
  return out;
}

async function checkRunnerTokens(userId: string): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const token = readTokenFile();
  const env = readRunnerEnv();
  const envToken = env.LOKI_DAEMON_TOKEN ?? "";
  const localToken = token ? await validateAgentToken(token) : null;
  out.push(
    check(
      "token-local",
      "Local runner token",
      token && localToken?.userId === userId ? "pass" : "fail",
      token && localToken?.userId === userId
        ? `Registered locally (${token.slice(0, 8)}…).`
        : "Missing or not registered for this user.",
    ),
  );
  out.push(
    check(
      "token-env",
      "Runner env token",
      token && envToken === token ? "pass" : "warn",
      token && envToken === token
        ? "daemon.env matches fleet-runner-token."
        : "daemon.env and fleet-runner-token differ.",
    ),
  );

  const remoteBase = (env.LOKI_BASE_URL || APP_URL).replace(/\/$/, "");
  if (token) {
    try {
      const res = await fetch(`${remoteBase}/api/beacon-settings`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      out.push(
        check(
          "token-cloud",
          "Cloud runner token",
          res.ok ? "pass" : "fail",
          `${remoteBase} returned HTTP ${res.status}.`,
        ),
      );
    } catch (err) {
      out.push(
        check(
          "token-cloud",
          "Cloud runner token",
          "fail",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  } else {
    out.push(
      check("token-cloud", "Cloud runner token", "fail", "No fleet-runner-token file found."),
    );
  }
  return out;
}

async function checkMigrations(): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const auditTable = await tableExists("control_audit_events").catch(() => false);
  const beaconTable = await tableExists("beacon_sessions").catch(() => false);
  const installedAgents = await columnExists("runtime_snapshots", "installed_agents").catch(
    () => false,
  );
  out.push(
    check(
      "migration:audit",
      "Audit migration",
      auditTable ? "pass" : "fail",
      auditTable ? "control_audit_events exists." : "control_audit_events is missing.",
    ),
  );
  out.push(
    check(
      "migration:beacon",
      "Beacon migration",
      beaconTable ? "pass" : "fail",
      beaconTable ? "beacon_sessions exists." : "beacon_sessions is missing.",
    ),
  );
  out.push(
    check(
      "migration:runtime",
      "Runtime snapshot migration",
      installedAgents ? "pass" : "fail",
      installedAgents
        ? "runtime_snapshots.installed_agents exists."
        : "runtime_snapshots.installed_agents is missing.",
    ),
  );
  return out;
}

async function checkTelemetry(): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  // Existence is not function. The three checks above prove tables EXIST — the
  // same thing every check proved for 76 days while claude_code_history quietly
  // stopped receiving rows. These ask the only question that can tell the
  // difference: is anything still arriving?
  const freshness = await checkTelemetryFreshness().catch(() => null);
  if (freshness === null) {
    out.push(
      check(
        "telemetry",
        "Telemetry freshness",
        "warn",
        "Could not query telemetry paths — not the same as healthy.",
      ),
    );
  } else {
    for (const r of freshness.results.filter((p) => p.monitored)) {
      const status: DoctorStatus =
        r.state === "flowing" ? "pass" : r.state === "unchecked" ? "warn" : "fail";
      out.push(
        check(
          `telemetry:${r.table}`,
          r.label,
          status,
          r.state === "flowing"
            ? `Last row ${humanizeAge(r.ageHours)} ago (budget ${r.maxSilenceHours}h).`
            : r.state === "silent"
              ? `NEVER carried a row. Written by: ${r.writer}`
              : r.state === "unchecked"
                ? `Could not read this path — not a pass.`
                : `STOPPED: last row ${humanizeAge(r.ageHours)} ago, budget ${r.maxSilenceHours}h. Written by: ${r.writer}`,
        ),
      );
    }
  }
  return out;
}

async function checkRunnerVersions(userId: string): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  // Publishing a release is not the same as a machine installing it. Nothing
  // compared the two until now, so the laptop sat on 0.8.12 for twelve days
  // while the box ran box-0.8.13 — and 0.8.12 predates the inject-hardening,
  // so it kept acking unverified injects softly and 29 runs died for it.
  //
  // No network and no new data: FLEET_RUNNER_RELEASES already says what
  // shipped, and every runner reports its version on every heartbeat.
  const snapshots = await getRuntimeSnapshots(userId).catch(() => null);
  if (snapshots === null) {
    out.push(
      check(
        "runner:version",
        "Runner version",
        "warn",
        "Could not read runtime snapshots — whether machines are up to date is UNKNOWN, which is not the same as current.",
      ),
    );
  } else if (snapshots.length === 0) {
    out.push(
      check(
        "runner:version",
        "Runner version",
        "warn",
        "No runner has reported in, so no machine can be confirmed up to date.",
      ),
    );
  } else {
    for (const snap of snapshots) {
      const v = runnerVersionStatus(snap.runnerVersion);
      const status: DoctorStatus =
        v.state === "behind" ? "fail" : v.state === "unknown" ? "warn" : "pass";
      out.push(
        check(
          `runner:version:${snap.channel ?? "unknown"}`,
          `Runner version (${snap.channel ?? "unknown"})`,
          status,
          v.detail,
        ),
      );
    }
  }
  return out;
}

async function checkLegacyPaths(): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const legacyPaths = [
    `${homedir()}/.config/cockpit`,
    `${homedir()}/.local/share/cockpit`,
    `${homedir()}/.local/share/cockpit-beacon`,
    "/tmp/cockpit-beacon",
    "/tmp/cockpit-hook-auth",
  ].filter((path) => existsSync(/*turbopackIgnore: true*/ path));
  out.push(
    check(
      "legacy-paths",
      "Legacy Cockpit paths",
      legacyPaths.length === 0 ? "pass" : "warn",
      legacyPaths.length === 0 ? "No live legacy paths found." : legacyPaths.join(", "),
    ),
  );
  return out;
}

/** One verdict from many: any failure fails the fleet, any warning warns it. */
function summarize(checks: DoctorCheck[]) {
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const status: DoctorStatus = fail > 0 ? "fail" : warn > 0 ? "warn" : "pass";
  return { status, pass, warn, fail };
}

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isRuntimeAvailable()) {
    return NextResponse.json({
      runtime: false,
      summary: { status: "warn", pass: 0, warn: 1, fail: 0 },
      checks: [
        check(
          "runtime",
          "Local runtime",
          "warn",
          "Fleet Doctor runs full checks only on the local install.",
        ),
      ],
    });
  }

  // Sequential on purpose: several probes shell out, and Fleet Doctor is a
  // human-initiated page, not a hot path. The ORDER is the report's order.
  const checks: DoctorCheck[] = [
    ...(await checkSystemdUnits()),
    ...(await checkClaudeHooks()),
    ...(await checkRunnerTokens(userId)),
    ...(await checkMigrations()),
    ...(await checkTelemetry()),
    ...(await checkRunnerVersions(userId)),
    ...(await checkLegacyPaths()),
  ];

  return NextResponse.json({
    runtime: true,
    checkedAt: new Date().toISOString(),
    summary: summarize(checks),
    checks,
  });
}
