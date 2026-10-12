import { NextResponse } from "next/server";
import { getDefaultUser } from "@/db/queries/users";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { isRuntimeAvailable } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/builder — is the shared cloud builder executing?
 *
 * /api/health says the web app is up. It said so all night on 2026-10-11 →
 * 12 while the box-runner — the thing that actually runs every dispatch for
 * every eligible account — was offline, and the only place that fact lived
 * was a chip inside a signed-in page. The owner found out by trying to work
 * from a second computer and being sent to download a desktop app.
 *
 * This answers the one question the fleet watchdog could not ask: 200 when
 * the owner's cloud builder is connected and heartbeating, 503 when it is
 * not. Public on purpose — the body is one boolean and one timestamp about a
 * service the operator runs, nothing about any account's records — so the box
 * watchdog (install-watchdog.sh) and the fleet uptime sweep can alert on the
 * state flip the way they already do for a 5xx.
 */
export async function GET() {
  if (isRuntimeAvailable()) {
    // A local runtime host IS its own builder; there is no cloud service to probe.
    return NextResponse.json({
      ok: true,
      cloud: { online: true, lastSeenAt: null },
      runtime: true,
    });
  }
  const owner = await getDefaultUser().catch(() => null);
  if (!owner) {
    return NextResponse.json({ ok: false, reason: "no default account" }, { status: 503 });
  }
  const [presence, snapshot] = await Promise.all([
    getBuilderPresence(owner.id).catch(() => ({ cloud: false, local: false, any: false })),
    getRuntimeSnapshot(owner.id, "cloud").catch(() => null),
  ]);
  const online = presence.cloud;
  return NextResponse.json(
    {
      ok: online,
      cloud: {
        online,
        lastSeenAt: snapshot?.observedAt?.toISOString() ?? null,
        version: snapshot?.runnerVersion ?? null,
      },
      runtime: false,
    },
    { status: online ? 200 : 503 },
  );
}
