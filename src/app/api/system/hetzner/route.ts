import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { getSessionUserId } from "@/lib/session";
import { isSiteOperator } from "@/db/queries/users";
import {
  HETZNER_STATE_FILE,
  HETZNER_RADAR_URL,
  HETZNER_CONSOLE_URL,
  HETZNER_RESCALE_STEPS,
} from "@/config/hetzner";

/**
 * Hetzner rescale-capacity for the box.
 *
 * The box is a cx33 and cannot simply be resized: Falkenstein is capacity-blocked
 * for the cx line, so a bigger type is only bookable during brief windows where
 * Hetzner reports it `available_for_migration`. hcloud-availability.sh polls that
 * every 10 min and writes the state file; this route just reads it.
 *
 * We do NOT call the Hetzner API from the web app: that would need the token in
 * the app's env (it currently lives root-only in /opt/monitoring/hcloud.env) and
 * would duplicate polling logic that already exists. The state file is the SSOT.
 *
 * When the file is absent — a dev laptop, or any host that is not the box — this
 * says so explicitly rather than rendering zeros that look like "nothing is
 * available". "We can't see it from here" and "it's unavailable" are different
 * facts and the card must not conflate them.
 */

export type HetznerServerType = {
  id: number;
  name: string | null;
  cores: number | null;
  memoryGb: number | null;
  diskGb: number | null;
  available?: boolean;
};

type HetznerState = {
  server?: string;
  location?: string;
  checkedAt?: string;
  current?: HetznerServerType | null;
  targets?: HetznerServerType[];
};

export type HetznerCapacityResponse = {
  tracked: boolean;
  reason?: string;
  server: string | null;
  location: string | null;
  checkedAt: string | null;
  /** Age of the reading in seconds — lets the UI flag a stalled poller. */
  ageSeconds: number | null;
  current: HetznerServerType | null;
  targets: HetznerServerType[];
  radarUrl: string;
  consoleUrl: string;
  rescaleSteps: string;
};

const LINKS = {
  radarUrl: HETZNER_RADAR_URL,
  consoleUrl: HETZNER_CONSOLE_URL,
  rescaleSteps: HETZNER_RESCALE_STEPS,
};

function untracked(reason: string): HetznerCapacityResponse {
  return {
    tracked: false,
    reason,
    server: null,
    location: null,
    checkedAt: null,
    ageSeconds: null,
    current: null,
    targets: [],
    ...LINKS,
  };
}

export async function GET() {
  // Same posture as /api/system: capacity telemetry is only for a signed-in
  // user, but an unauthenticated poller gets a benign payload rather than a 401.
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(untracked("Sign in to see box capacity."));
  }
  // The box is the site operator's; its size and upgrade watch are not a
  // tenant's to read (see /system).
  if (!(await isSiteOperator(userId).catch(() => false))) {
    return NextResponse.json(untracked("Box capacity is the site operator's."));
  }

  if (!existsSync(/*turbopackIgnore: true*/ HETZNER_STATE_FILE)) {
    return NextResponse.json(
      untracked("Capacity watch runs on the box; this host has no reading to show."),
    );
  }

  let state: HetznerState;
  let checkedAtFallback: string | null = null;
  try {
    state = JSON.parse(
      readFileSync(/*turbopackIgnore: true*/ HETZNER_STATE_FILE, "utf8"),
    ) as HetznerState;
    checkedAtFallback = statSync(/*turbopackIgnore: true*/ HETZNER_STATE_FILE).mtime.toISOString();
  } catch {
    return NextResponse.json(untracked("Capacity state file is present but unreadable."));
  }

  const checkedAt = state.checkedAt ?? checkedAtFallback;
  const parsed = checkedAt ? Date.parse(checkedAt) : NaN;
  const ageSeconds = Number.isNaN(parsed)
    ? null
    : Math.max(0, Math.round((Date.now() - parsed) / 1000));

  return NextResponse.json({
    tracked: true,
    server: state.server ?? null,
    location: state.location ?? null,
    checkedAt,
    ageSeconds,
    current: state.current ?? null,
    targets: Array.isArray(state.targets) ? state.targets : [],
    ...LINKS,
  } satisfies HetznerCapacityResponse);
}
