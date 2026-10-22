"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { FetchErrorState } from "@/components/ui/fetch-error-state";
import { getJson, postJson } from "@/lib/api/fetch";
import { useFetch } from "@/hooks/use-fetch";
import { REFRESH_CADENCE } from "@/config/refresh";

type GlobalAutoContinue = {
  enabled: boolean;
  total: number;
  disabled: number;
};

export function GlobalAutoContinueCard() {
  const { data, loading, error, refetch } = useFetch<GlobalAutoContinue>(
    "/api/control/auto-continue?all=1",
    {
      intervalMs: REFRESH_CADENCE.system,
      timeoutMs: 10_000,
    },
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const setAll = async (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await postJson("/api/control/auto-continue", { all: true, enabled });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await getJson<GlobalAutoContinue>("/api/control/auto-continue?all=1");
      setMessage(
        `${enabled ? "Carrying on in" : "Paused"} ${json.total} project${json.total === 1 ? "" : "s"}.`,
      );
      refetch();
    } catch {
      setMessage("Could not change it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Pause} title="Agents keep going" />
        <p className="text-sm text-text-secondary">Loading…</p>
      </SystemBlock>
    );
  }

  if (error || !data) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Pause} title="Agents keep going" />
        <FetchErrorState message="Could not load this" detail={error} onRetry={refetch} />
      </SystemBlock>
    );
  }

  // One switch, said as a sentence: what happens now, and the one button that
  // changes it. It was "Global auto-continue · 3 paused" over "Automatic
  // continuation is enabled for all tracked projects" and two buttons, one
  // of them filled.
  const paused = data.disabled;
  return (
    <SystemBlock>
      <SystemBlockHeader title="Agents keep going" />
      <p className="text-sm text-text-secondary">
        {paused === 0
          ? "When an agent finishes, the next task in its project starts by itself."
          : paused === data.total
            ? "Paused everywhere: an agent stops when its task is done."
            : `Agents carry on by themselves, except in ${paused} paused ${paused === 1 ? "project" : "projects"}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {paused < data.total && (
          <button
            type="button"
            className="ui-btn-secondary"
            disabled={busy}
            onClick={() => setAll(false)}
          >
            <Pause className="h-4 w-4" /> Pause everywhere
          </button>
        )}
        {paused > 0 && (
          <button
            type="button"
            className="ui-btn-secondary"
            disabled={busy}
            onClick={() => setAll(true)}
          >
            <Play className="h-4 w-4" /> Carry on everywhere
          </button>
        )}
      </div>
      {message && <p className="mt-2 text-sm text-text-tertiary">{message}</p>}
    </SystemBlock>
  );
}
