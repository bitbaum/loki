import { NextResponse } from "next/server";
import os from "node:os";
import { statfsSync } from "node:fs";
import { OPENCLAW_GATEWAY_URL } from "@/lib/constants";
import { getSessionUserId } from "@/lib/session";
import { isSiteOperator } from "@/db/queries/users";

// The empty payload returned to unauthenticated callers — same shape the /system
// page already handles, so a monitor polling this GET keeps working but learns
// nothing about host capacity/load.
const EMPTY = {
  mem: null,
  swap: null,
  disk: null,
  uptime: null,
  gatewayStatus: "down",
  runtime: false,
};

const MIB = 1024 * 1024;

/** os.uptime() seconds → "up 3d 4h" / "up 4h 12m" / "up 6m". */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `up ${d}d ${h}h`;
  if (h > 0) return `up ${h}h ${m}m`;
  return `up ${m}m`;
}

/** Is the OpenClaw gateway (a local-machine service) reachable? Direct fetch with
 *  a short timeout — no shell-out, so it works on the hosted box too (where it
 *  simply reports down, which is the truth: the gateway runs on the laptop). */
async function gatewayReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  // GET is excluded from the auth matcher for runner/monitoring reachability,
  // but host mem/disk/uptime is real telemetry — only expose it to a signed-in
  // user; everyone else gets the benign empty payload (no 401 that could break
  // a poller, no fingerprintable capacity data).
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(EMPTY);
  }
  // The machine is the site operator's: every account runs on it, so its
  // RAM, disk and uptime are not any one tenant's to read (see /system).
  if (!(await isSiteOperator(userId).catch(() => false))) {
    return NextResponse.json(EMPTY);
  }

  // Host mem / uptime / disk come from Node's own view of the machine the web
  // server runs on — native, no shell-out, no RUNTIME_AVAILABLE gate. That means
  // the hosted box reports its real RAM/disk/uptime instead of a wall of "n/a".
  // (Historically these were shelled out via runTool and disappeared on hosted.)
  const totalMiB = Math.round(os.totalmem() / MIB);
  const freeMiB = Math.round(os.freemem() / MIB);
  const mem = { totalMiB, usedMiB: totalMiB - freeMiB, availMiB: freeMiB };

  let disk: { totalMiB: number; usedMiB: number; availMiB: number; pct: number } | null = null;
  try {
    const fs = statfsSync("/");
    const blockMiB = fs.bsize / MIB;
    const dTotal = Math.round(fs.blocks * blockMiB);
    const dAvail = Math.round(fs.bavail * blockMiB);
    const dUsed = Math.round((fs.blocks - fs.bfree) * blockMiB);
    const denom = dUsed + dAvail;
    disk = {
      totalMiB: dTotal,
      usedMiB: dUsed,
      availMiB: dAvail,
      pct: denom > 0 ? Math.round((dUsed / denom) * 100) : 0,
    };
  } catch {
    disk = null;
  }

  return NextResponse.json({
    mem,
    // Node's os module doesn't expose swap; omit it rather than fabricate.
    swap: null,
    disk,
    uptime: formatUptime(os.uptime()),
    gatewayStatus: (await gatewayReachable()) ? "ok" : "down",
    runtime: true,
  });
}
