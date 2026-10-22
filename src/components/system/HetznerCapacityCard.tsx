"use client";

import { ExternalLink, Server } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { FetchErrorState } from "@/components/ui/fetch-error-state";
import { useFetch } from "@/hooks/use-fetch";
import { REFRESH_CADENCE } from "@/config/refresh";
import type { HetznerCapacityResponse, HetznerServerType } from "@/app/api/system/hetzner/route";

/**
 * Box upgrade capacity. The box is capacity-blocked for rescales — a bigger
 * server type is only bookable during brief windows — so this answers the one
 * question worth asking: can I upgrade right now, and if not, how fresh is that
 * answer? Every figure comes from the Hetzner API via the poller's state file.
 */

/** "8 vCPU · 16 GB · 160 GB" — omits parts the API didn't return rather than guessing. */
function specLine(t: HetznerServerType): string {
  const parts = [
    t.cores != null ? `${t.cores} vCPU` : null,
    t.memoryGb != null ? `${t.memoryGb} GB RAM` : null,
    t.diskGb != null ? `${t.diskGb} GB disk` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "specs unavailable";
}

function freshness(ageSeconds: number | null): { text: string; stale: boolean } {
  if (ageSeconds == null) return { text: "age unknown", stale: true };
  const min = Math.round(ageSeconds / 60);
  if (min < 1) return { text: "checked just now", stale: false };
  if (min < 60) return { text: `checked ${min} min ago`, stale: min > 30 };
  const h = Math.round(min / 60);
  // The poller runs every 10 min; anything over an hour means it has stalled.
  return { text: `checked ${h}h ago`, stale: true };
}

export function HetznerCapacityCard() {
  const { data, loading, error, refetch } = useFetch<HetznerCapacityResponse>(
    "/api/system/hetzner",
    {
      intervalMs: REFRESH_CADENCE.system,
      timeoutMs: 15_000,
    },
  );

  if (loading) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Server} title="Server size" />
        <p className="text-sm text-text-secondary">Checking rescale availability...</p>
      </SystemBlock>
    );
  }

  if (error || !data) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Server} title="Server size" />
        <FetchErrorState message="Couldn't read box capacity" detail={error} onRetry={refetch} />
      </SystemBlock>
    );
  }

  const radarLink = (
    <a
      href={data.radarUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="ui-tap inline-flex items-center gap-1 text-text-secondary underline underline-offset-2 hover:text-text-primary"
    >
      availability history <ExternalLink className="h-3 w-3" />
    </a>
  );

  // Not on the box: say that, rather than showing zeros that read as "nothing
  // is available". Unknown and unavailable are different answers.
  if (!data.tracked) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Server} title="Server size" />
        <p className="text-sm text-text-secondary">
          {data.reason ?? "No capacity reading available here."}
        </p>
        <p className="mt-2 text-xs text-text-tertiary">Track it externally: {radarLink}</p>
      </SystemBlock>
    );
  }

  const open = data.targets.filter((t) => t.available);
  const age = freshness(data.ageSeconds);

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={Server}
        title="Server size"
        right={
          <span
            className={age.stale ? "text-xs text-status-warning" : "text-xs text-text-tertiary"}
          >
            {age.text}
          </span>
        }
      />

      {data.current && (
        <p className="text-sm text-text-secondary">
          <span className="text-text-primary">
            {data.server ?? "box"} — {data.current.name ?? "unknown type"}
          </span>{" "}
          ({specLine(data.current)}){data.location ? ` in ${data.location}` : ""}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {data.targets.map((t) => (
          // Narrow screens drop the spec line onto its own row (order-3 + w-full)
          // so it can wrap freely instead of flowing underneath the status word.
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="text-text-primary">{t.name ?? `type ${t.id}`}</span>
            <span className="order-3 w-full text-xs text-text-tertiary sm:order-none sm:w-auto">
              {specLine(t)}
            </span>
            <span
              className={
                t.available
                  ? "order-2 ml-auto shrink-0 text-status-positive"
                  : "order-2 ml-auto shrink-0 text-text-tertiary"
              }
            >
              {t.available ? "available now" : "blocked"}
            </span>
          </li>
        ))}
        {data.targets.length === 0 && (
          <li className="text-sm text-text-secondary">No upgrade targets are being watched.</li>
        )}
      </ul>

      {open.length > 0 ? (
        // A window is open and they close fast — lead with the action.
        <p className="mt-3 text-sm text-status-positive">
          Upgrade window is OPEN. {data.rescaleSteps}.{" "}
          <a
            href={data.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Open console <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      ) : (
        <p className="mt-3 text-xs text-text-tertiary">
          Rescale is capacity-blocked right now. You get a Telegram alert the moment a window opens
          — or watch the {radarLink}.
        </p>
      )}
    </SystemBlock>
  );
}
