"use client";

import { Cpu, HardDrive, Radio, Server } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { FetchErrorState } from "@/components/ui/fetch-error-state";
import { useFetch } from "@/hooks/use-fetch";
import { ProgressBar, getProgressTone } from "@/components/ui/progress-bar";
import { HEALTH_THRESHOLDS } from "@/config/ui";
import { formatBytes } from "@/lib/format";
import { REFRESH_CADENCE } from "@/config/refresh";

type MemInfo = { totalMiB: number; usedMiB: number; availMiB: number };
type SwapInfo = { totalMiB: number; usedMiB: number };
type DiskInfo = { totalMiB: number; usedMiB: number; availMiB: number; pct: number };

type SystemData = {
  mem: MemInfo | null;
  swap: SwapInfo | null;
  disk: DiskInfo | null;
  uptime: string | null;
  gatewayStatus: "ok" | "down";
};

function UsageBar({ usedMiB, totalMiB }: { usedMiB: number; totalMiB: number }) {
  const pct = totalMiB > 0 ? Math.round((usedMiB / totalMiB) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <ProgressBar
        value={pct}
        tone={getProgressTone(pct, {
          negativeAt: HEALTH_THRESHOLDS.criticalPct,
          warningAt: HEALTH_THRESHOLDS.warningPct,
          lowTone: "positive",
        })}
        className="h-2 flex-1"
      />
      <span className="w-10 text-right text-sm text-text-tertiary">{pct}%</span>
    </div>
  );
}

export function SystemStats() {
  // 10s ceiling = 2× the server's 5s runTool cap; covers network jitter while
  // ensuring a hung /api/system call surfaces FetchErrorState instead of
  // pinning the panel on stale data for the full poll interval. Cadence
  // shared with the server-card AutoRefresh on /system so the surface has
  // one consistent freshness story.
  const { data, loading, error, refetch } = useFetch<SystemData>("/api/system", {
    intervalMs: REFRESH_CADENCE.system,
    timeoutMs: 10_000,
  });

  if (loading) {
    return (
      <div className="animate-pulse text-base text-text-secondary">Loading system status...</div>
    );
  }
  if (error || !data) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Cpu} title="Server" />
        <FetchErrorState
          message="Could not read the server just now"
          detail={error}
          onRetry={refetch}
        />
      </SystemBlock>
    );
  }

  const { mem, swap, disk, uptime, gatewayStatus } = data;

  return (
    // Gateway and Uptime were two full cards, each with an icon header, to
    // carry one short fact apiece — on a phone that is two screenfuls before
    // the first reading with any detail in it. They are both "how is the host
    // doing", so they are two rows of one card now.
    //
    // The same argument, one level up: Host, Memory and Disk were three cards
    // with three icon headers and three borders to carry six facts about ONE
    // subject — this box, right now — which cost roughly 400px of a phone
    // screen before the first reading with any detail in it. One card, three
    // sections; the inner grid keeps the horizontal layout on desktop, so only
    // the repeated card chrome is gone rather than the density.
    <SystemBlock>
      <SystemBlockHeader icon={Server} title="Server" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
        <section>
          <div className="ui-micro-label mb-2 flex items-center gap-1.5">
            <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
            Host
          </div>
          <div className="space-y-2">
            <div className="ui-label-row">
              <span>Assistant link</span>
              <span className="flex items-center gap-2 text-text-primary">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${gatewayStatus === "ok" ? "bg-status-positive" : "bg-status-negative"}`}
                />
                {gatewayStatus === "ok" ? "Reachable" : "Unavailable"}
              </span>
            </div>
            <div className="ui-label-row">
              <span>Uptime</span>
              <span className="text-text-primary">{uptime ?? "not reporting"}</span>
            </div>
          </div>
        </section>

        <section>
          <div className="ui-micro-label mb-2 flex items-center gap-1.5">
            <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
            Memory
          </div>
          {mem ? (
            <div className="space-y-3">
              <div>
                <div className="ui-label-row">
                  <span>RAM</span>
                  <span>
                    {formatBytes(mem.usedMiB, "MiB")} / {formatBytes(mem.totalMiB, "MiB")}
                  </span>
                </div>
                <UsageBar usedMiB={mem.usedMiB} totalMiB={mem.totalMiB} />
              </div>
              {swap && swap.totalMiB > 0 && (
                <div>
                  <div className="ui-label-row">
                    <span>Swap</span>
                    <span>
                      {formatBytes(swap.usedMiB, "MiB")} / {formatBytes(swap.totalMiB, "MiB")}
                    </span>
                  </div>
                  <UsageBar usedMiB={swap.usedMiB} totalMiB={swap.totalMiB} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-base text-text-secondary">n/a</p>
          )}
        </section>

        <section>
          <div className="ui-micro-label mb-2 flex items-center gap-1.5">
            <HardDrive className="h-3 w-3 shrink-0" aria-hidden="true" />
            Disk
          </div>
          {disk ? (
            <div className="space-y-2">
              <div className="ui-label-row">
                <span>/</span>
                <span>
                  {formatBytes(disk.usedMiB, "MiB")} / {formatBytes(disk.totalMiB, "MiB")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ProgressBar
                  value={disk.pct}
                  tone={getProgressTone(disk.pct, {
                    negativeAt: HEALTH_THRESHOLDS.criticalPct,
                    warningAt: HEALTH_THRESHOLDS.warningPct,
                    lowTone: "positive",
                  })}
                  className="h-2 flex-1"
                />
                <span className="w-10 text-right text-sm text-text-tertiary">{disk.pct}%</span>
              </div>
              <div className="text-xs text-text-tertiary">
                {formatBytes(disk.availMiB, "MiB")} free
              </div>
            </div>
          ) : (
            <p className="text-base text-text-secondary">n/a</p>
          )}
        </section>
      </div>
    </SystemBlock>
  );
}
