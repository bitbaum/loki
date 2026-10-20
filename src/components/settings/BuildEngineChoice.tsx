"use client";

import { useEffect, useState } from "react";
import { Hammer } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { ownModelRequest } from "@/lib/own-model-client";

type View = {
  choice: "own" | "loki";
  lokiAvailable: boolean;
  welcomeBuilds: number;
  planBuildsMonthly: number;
  welcomeLeft: number | null;
  planLeft: number | null;
  exhausted: string | null;
};

/**
 * What your builds run on — the one choice behind "whoever asks pays". Your
 * own engine is the default and is never counted; Loki's is a number of
 * builds, said here, and the box swaps the key in your builder within a
 * minute of the change (scripts/write-tenant-engines.ts).
 */
export function BuildEngineChoice() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ownModelRequest<View>("/api/settings/build-engine", "GET")
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, []);

  async function choose(choice: "own" | "loki") {
    if (!view || view.choice === choice) return;
    setBusy(true);
    setError(null);
    try {
      setView(await ownModelRequest<View>("/api/settings/build-engine", "PATCH", { choice }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return error ? <p className="ui-error">{error}</p> : null;
  const lokiMeans = !view.lokiAvailable
    ? "Not on this server."
    : view.exhausted
      ? view.exhausted
      : `${view.welcomeLeft ?? view.welcomeBuilds} welcome builds left, then ${view.planBuildsMonthly} a month on your plan. Loki's key, Loki's bill; reaches your builder within a minute.`;

  return (
    <section className="ui-settings-section" aria-labelledby="build-engine-title">
      <div>
        <h2 id="build-engine-title" className="flex items-center gap-2 text-lg font-semibold">
          <Hammer className="h-5 w-5" aria-hidden="true" /> Your engine for building
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Whoever asks for a change pays for it, with their own engine, in their own builder.
          Nothing you build runs on anyone else&apos;s subscription, and nobody&apos;s runs on
          yours.
        </p>
      </div>
      <Segmented
        label="Build with"
        options={[
          {
            id: "own",
            label: "Your own",
            means:
              "Your sign-in — start the agent in Sessions and type /login — or a key marked “also for building” below. Your vendor bills you; Loki counts nothing.",
          },
          { id: "loki", label: "Loki's engine", means: lokiMeans },
        ]}
        value={view.choice}
        onChange={(id) => void choose(id as "own" | "loki")}
      />
      {busy && <p className="text-xs text-text-tertiary">Saving…</p>}
      {error && <p className="ui-error">{error}</p>}
    </section>
  );
}
