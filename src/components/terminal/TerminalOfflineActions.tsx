"use client";

import Link from "next/link";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import type { TerminalSource } from "@/config/terminal-modes";
import type { BuilderPresenceSnapshot } from "@/hooks/use-builder-presence";
import {
  builderWayForward,
  cloudBuilderState,
  downloadIsTheWayForward,
} from "@/lib/builder-way-forward";

/**
 * The way forward from an empty terminal whose builder is gated or offline.
 * The hint above it names what to do ("use this computer", "use the cloud
 * builder", "connect Fleet Runner"), so the doing is a button on the same
 * screen, not a sentence to act on somewhere else.
 *
 * Which button leads depends on the account, not the device. "Get Fleet
 * Runner" was the one constant here, and from a second computer it sent the
 * owner — whose cloud builder was online — to a download (2026-10-12).
 */
export function TerminalOfflineActions({
  source,
  presence,
  onSwitch,
}: {
  source: TerminalSource;
  presence: BuilderPresenceSnapshot;
  onSwitch: (next: TerminalSource) => void;
}) {
  const cloud = cloudBuilderState(presence.cloudBuilderAllowed, presence.builderPresence);
  const onMachine = source === "machine";
  const way = builderWayForward({ cloud, waitingOn: onMachine ? "local" : "cloud" });
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-2">
      {onMachine && way === "run-in-cloud" && (
        <button
          type="button"
          className="ui-btn-primary ui-btn-sm"
          onClick={() => onSwitch("cloud")}
        >
          {EXECUTOR_COPY.terminal.useCloudBuilder}
        </button>
      )}
      {source === "cloud" && (
        <button
          type="button"
          className="ui-btn-secondary ui-btn-sm"
          onClick={() => onSwitch("machine")}
        >
          Use this computer
        </button>
      )}
      {downloadIsTheWayForward(way) && (
        <Link href="/download" className="ui-btn-ghost ui-btn-sm">
          Get Fleet Runner
        </Link>
      )}
    </div>
  );
}
