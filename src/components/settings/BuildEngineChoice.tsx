"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { ownModelRequest } from "@/lib/own-model-client";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

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

  return (
    <section className="ui-settings-section" aria-labelledby="build-engine-title">
      <SettingsSectionHeader
        id="build-engine-title"
        title="Your engine for building"
        lede="Whoever asks for a change pays for it, with their own engine, in their own builder. Nothing you build runs on anyone else's subscription, and nobody's runs on yours."
      />
      <Segmented
        label="Build with"
        options={[
          {
            id: "own",
            label: "Your own",
            means:
              "Your sign-in — start the agent in Sessions and type /login — or a key marked “also for building” under Your providers. Your vendor bills you; Loki counts nothing.",
          },
          { id: "loki", label: "Loki's engine", means: lokiMeans(view) },
        ]}
        value={view.choice}
        onChange={(id) => void choose(id as "own" | "loki")}
      />
      {busy && <p className="text-xs text-text-tertiary">Saving…</p>}
      {error && <p className="ui-error">{error}</p>}
    </section>
  );
}

/**
 * What Loki's engine means for THIS account, with no number that is not
 * true for it: on Free the plan adds no builds, so the line must not say
 * "then 0 a month on your plan" (it did, 2026-10-21).
 */
function lokiMeans(view: View): string {
  if (!view.lokiAvailable) return "Not on this server.";
  if (view.exhausted) return view.exhausted;
  const welcome = view.welcomeLeft ?? view.welcomeBuilds;
  const head = `${welcome} welcome build${welcome === 1 ? "" : "s"} left`;
  const then =
    view.planBuildsMonthly > 0
      ? `, then ${view.planLeft ?? view.planBuildsMonthly} of ${view.planBuildsMonthly} a month on your plan`
      : "; a paid plan adds a monthly number";
  return `${head}${then}. Loki's key, Loki's bill; reaches your builder within a minute.`;
}
