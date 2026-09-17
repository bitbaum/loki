"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Repeat2 } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { AgentSwitcherPopover } from "@/components/control/agent-switcher-popover";
import { PROVIDER_BLOCK_NOTE, type ProviderOption } from "@/lib/provider-switch";

/**
 * "Try next provider" — the one control, wherever a run is blocked.
 *
 * Rendered on the Feedback row, in the Control inbox, and in the Terminal rail,
 * all from `/api/providers`, so the three surfaces cannot recommend different
 * agents for the same stuck project. The primary button is the operator's
 * FIRST preferred provider that can actually answer; the caret opens the rest,
 * with the ones that cannot answer still listed and disabled, saying why.
 *
 * It does not itself perform the switch: on Feedback that means re-dispatching
 * the report on a new agent, in Terminal it means swapping the live PTY. The
 * caller owns the verb; this owns the choice.
 */
export type ProviderSwitchResponse = {
  current: string | null;
  options: ProviderOption[];
  next: ProviderOption | null;
  installedKnown: boolean;
};

export function ProviderSwitch({
  projectId,
  busy,
  compact,
  hint = "Runs this again on the provider you pick, and remembers it for this project.",
  onSwitch,
}: {
  /** user_projects id — scopes "current" so the spent agent is never offered. */
  projectId: string | null;
  busy?: boolean;
  /** Inbox density: smaller buttons, same behaviour. */
  compact?: boolean;
  /** What picking one will do, in the caller's own terms. */
  hint?: string;
  onSwitch: (agentId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data, loading } = useFetch<ProviderSwitchResponse>(
    projectId ? `/api/providers?project=${projectId}` : "/api/providers",
  );

  // Nothing to offer is a real state and must not render an empty control:
  // every alternative is spent or uninstalled, and the honest answer is the
  // reason on the row above, not a button that cannot do anything.
  const next = data?.next ?? null;
  if (loading && !data) {
    return (
      <span className="inline-flex items-center gap-1 text-micro text-text-muted">
        <Loader2 className="ui-spinner-xs" /> providers…
      </span>
    );
  }
  if (!next) return null;

  const btnClass = compact ? "ui-btn-save ui-btn-sm gap-1.5" : "ui-btn-save gap-1.5";
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => onSwitch(next.id)}
        disabled={busy}
        className={btnClass}
        title={`Run this again on ${next.label} and remember it for this project`}
      >
        {busy ? <Loader2 className="ui-spinner-xs" /> : <Repeat2 className="h-3 w-3" />}
        Try {next.label}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        className="ui-btn-icon"
        title="Choose a different provider"
        aria-label="Choose a different provider"
        aria-expanded={menuOpen}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <AgentSwitcherPopover
          agents={(data?.options ?? []).map((o) => ({
            id: o.id,
            label: o.label,
            available: o.usable,
            ...(o.reason ? { availabilityReason: o.reason } : {}),
            ...(o.block ? { unavailableNote: PROVIDER_BLOCK_NOTE[o.block] } : {}),
          }))}
          activeAgentId={data?.current ?? ""}
          title="Try another provider"
          hint={hint}
          onSwitch={(id) => {
            if (id) onSwitch(id);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </span>
  );
}
