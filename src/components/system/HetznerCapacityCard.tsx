"use client";

import Link from "next/link";
import { ExternalLink, Server } from "lucide-react";
import { askLokiHref } from "@/config/box-alert-copy";
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

/** The poller runs every 10 min; a reading older than this is not an answer any more. */
const DEAD_AFTER_S = 6 * 3600;

function freshness(ageSeconds: number | null): { text: string; stale: boolean } {
  if (ageSeconds == null) return { text: "age unknown", stale: true };
  const min = Math.round(ageSeconds / 60);
  if (min < 1) return { text: "checked just now", stale: false };
  if (min < 60) return { text: `checked ${min} min ago`, stale: min > 30 };
  const h = Math.round(min / 60);
  if (h < 48) return { text: `checked ${h}h ago`, stale: true };
  return { text: `checked ${Math.round(h / 24)} days ago`, stale: true };
}

/** "41 days" / "9 hours" — how long ago Loki last looked. */
function sinceWords(ageSeconds: number): string {
  const h = Math.round(ageSeconds / 3600);
  if (h < 48) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
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

  // Your own size is not an upgrade: listed as "blocked", it read as "your
  // server is blocked" (2026-11-12).
  const targets = data.targets.filter(
    (t) => !data.current || (t.id !== data.current.id && t.name !== data.current.name),
  );
  const open = targets.filter((t) => t.available);
  const age = freshness(data.ageSeconds);
  const current = data.current && (
    <p className="text-sm text-text-secondary">
      <span className="text-text-primary">Now: {specLine(data.current)}</span>
      {data.current.name ? ` (${data.current.name})` : ""}
    </p>
  );

  // A reading weeks old drew "blocked" beside every size and promised a
  // Telegram alert "the moment a window opens" from a poller that had
  // stopped (1001 h, 2026-11-12). An old answer is no answer: say so, and
  // hand the restart to Loki.
  if (data.ageSeconds == null || data.ageSeconds > DEAD_AFTER_S) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Server} title="Server size" />
        {current}
        <p className="mt-3 text-sm text-text-secondary">
          {data.ageSeconds == null
            ? "Loki does not know when it last checked for a bigger server, so it cannot say whether one is available."
            : `Loki stopped checking for a bigger server ${sinceWords(data.ageSeconds)} ago, so it cannot say whether one is available.`}
        </p>
        <Link
          href={askLokiHref(
            "The Hetzner capacity watcher on the server stopped updating, so /system cannot say whether a bigger server is available. Find out why it stopped, restart it, and confirm a fresh reading arrives.",
          )}
          className="ui-btn-secondary mt-3 inline-flex min-h-11 items-center px-4"
        >
          Ask Loki to restart the check
        </Link>
      </SystemBlock>
    );
  }

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

      {current}

      <ul className="mt-3 space-y-2">
        {targets.map((t) => (
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
              {t.available ? "available now" : "not available"}
            </span>
          </li>
        ))}
        {targets.length === 0 && (
          <li className="text-sm text-text-secondary">No bigger size is being watched.</li>
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
          A bigger server is not available to book right now. You get a Telegram message the moment
          one is — or see the {radarLink}.
        </p>
      )}
    </SystemBlock>
  );
}
