import { EXECUTOR_COPY } from "@/config/executor-copy";
import { FLEET_RUNNER_RELEASES } from "@/config/changelog";
import { RUNNER_OFFLINE_THRESHOLD_MS } from "@/lib/constants/runner";
import type { RunnerStateKey } from "@/lib/control-states";

export type BuilderChannelPresence = {
  cloud: boolean;
  local: boolean;
  any: boolean;
};

/** A channel's last heartbeat — the only liveness signal that carries a time. */
export type ChannelHeartbeat = {
  channel: string;
  observedAt: Date | null;
  /** Null = the runner never told us. Never conflate with "battery". */
  powerSource?: "ac" | "battery" | null;
};

/**
 * Is this channel's heartbeat still fresh? SSOT for the snapshot-freshness
 * rule that /api/control applies to tabs, versions, and installed agents.
 *
 * Safe to demand a heartbeat: the runner pushes a runtime snapshot every
 * RUNNER_HEARTBEAT_MS whether or not anything changed (and once immediately
 * at launch), so silence past the threshold means the channel stopped
 * reporting — not that the fleet was quiet.
 */
export function isHeartbeatFresh(observedAt: Date | null | undefined, nowMs = Date.now()): boolean {
  const t = observedAt?.getTime();
  return t != null && nowMs - t < RUNNER_OFFLINE_THRESHOLD_MS;
}

/**
 * Expire connection-based presence that the heartbeat no longer corroborates.
 *
 * `runner_presence` is written by the bridge on SSE connect/disconnect and has
 * NO expiry of its own: `markDisconnect` is fire-and-forget, so a disconnect
 * lost to a DB blip — or a half-open socket the bridge never sees close —
 * pins `connected = true` until the bridge process restarts. Every other
 * liveness claim on Control expires (tabs, versions, runtime observations);
 * this one outlived its evidence and could assert "this computer online" for
 * a laptop that had been shut for days.
 *
 * AND, not OR: a runner that posts snapshots while its SSE channel is down
 * cannot receive dispatches, so it is not online either. Both signals must
 * agree before we claim a builder can execute.
 */
export function applyHeartbeatExpiry(
  connection: BuilderChannelPresence,
  heartbeats: ChannelHeartbeat[],
  nowMs = Date.now(),
): BuilderChannelPresence {
  const fresh = (channel: string) =>
    heartbeats.some((h) => h.channel === channel && isHeartbeatFresh(h.observedAt, nowMs));
  const cloud = connection.cloud && fresh("cloud");
  const local = connection.local && fresh("local");
  return { cloud, local, any: cloud || local };
}

/** "box-0.8.44" → "0.8.44"; a bare word ("box", "dev") has no number. */
function versionNumber(version: string | null | undefined): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * The cloud builder runs code older than this deploy ships. It restarts only
 * when none of its agents is working (scripts/hetzner/drain-and-restart-
 * runner.sh), and meanwhile holds new work (lib/runner-update-hold) so that
 * moment comes. Until it does, what it streams — a session's model, a job's
 * live step — may lack what this app expects, and the person deserves to be
 * told why rather than shown "not known yet".
 */
export function builderBehind(
  reported: string | null | undefined,
  current: string | null | undefined = FLEET_RUNNER_RELEASES[0]?.version,
): boolean {
  const have = versionNumber(reported);
  const want = versionNumber(current);
  if (!have || !want) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i]! < want[i]!) return true;
    if (have[i]! > want[i]!) return false;
  }
  return false;
}

/** One quiet clause for the builder line, or null when it is current. */
export function builderUpdateNote(cloudVersion: string | null | undefined): string | null {
  return builderBehind(cloudVersion) ? "a newer version waits for its agents to finish" : null;
}

/** True when the last runtime-state push came from the headless box-runner. */
export function isCloudRunnerVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  return version.startsWith("box-") || version.startsWith("box/");
}

/** Infer channel presence from legacy signals when DB columns are absent. */
export function inferBuilderChannelPresence(input: {
  connected: boolean;
  cloudConnected?: boolean | null;
  localConnected?: boolean | null;
  runnerVersion?: string | null;
}): BuilderChannelPresence {
  const cloud =
    input.cloudConnected ?? (input.connected && isCloudRunnerVersion(input.runnerVersion));
  const local =
    input.localConnected ?? (input.connected && !isCloudRunnerVersion(input.runnerVersion));
  return { cloud: !!cloud, local: !!local, any: !!(cloud || local) };
}

/** Compact fleet-header label — cloud vs this-computer, including dual state. */
export function builderCompactLabel(
  stateKey: RunnerStateKey,
  runnerVersion?: string | null,
  channels?: Pick<BuilderChannelPresence, "cloud" | "local"> | null,
): string {
  if (stateKey === "connected") {
    const cloud = channels?.cloud ?? isCloudRunnerVersion(runnerVersion);
    const local = channels?.local ?? (!!runnerVersion && !isCloudRunnerVersion(runnerVersion));

    if (cloud && local) return EXECUTOR_COPY.builder.bothOnline;
    if (cloud) return EXECUTOR_COPY.builder.cloudOnline;
    if (local) return EXECUTOR_COPY.builder.localComputerOnline;
    if (runnerVersion) return EXECUTOR_COPY.builder.online;
    return EXECUTOR_COPY.builder.online;
  }

  const map: Record<RunnerStateKey, string> = {
    setup_needed: EXECUTOR_COPY.builder.setupOptional,
    offline: EXECUTOR_COPY.builder.offline,
    state_unknown: EXECUTOR_COPY.builder.uncertain,
    connected: EXECUTOR_COPY.builder.online,
  };
  return map[stateKey];
}

/** Detail line under the compact label — which builder is missing when partially offline. */
export function builderPresenceDetail(channels: BuilderChannelPresence): string | null {
  if (channels.cloud && channels.local) return null;
  if (channels.cloud && !channels.local) return EXECUTOR_COPY.builder.cloudOnlyDetail;
  if (!channels.cloud && channels.local) return EXECUTOR_COPY.builder.localOnlyDetail;
  return null;
}
