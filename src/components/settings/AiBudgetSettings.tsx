"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Gauge, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import type { BudgetAction, BudgetView, FreePoolBudget, OwnKeyBudget } from "@/lib/ai/budget-view";
import { ownModelRequest } from "@/lib/own-model-client";
import { describeChatModel } from "@/lib/loki/models";
import { MODEL_STORE_PATH } from "@/lib/own-model-path";

/**
 * "Your AI budget today" — what this person can still ask, on every source
 * Loki can answer from, before they are refused.
 *
 * The card below it ("The free pool") is the operator's: vendor counters for
 * the whole box. This one is the person's: their share of that pool and how
 * much of it has unlocked so far, what their own keys spent, and what each
 * free model's vendor last said. It reads the same view the gate refuses on
 * (`/api/ai/budget`), so the number here and the refusal in the chat can
 * never disagree.
 *
 * Built to the same rule as the capacity card: no bare percentage. The big
 * number is answers, the bar is the share, and every source ends in what to
 * do about it.
 */
export function AiBudgetSettings() {
  const { data, loading, error, refetch } = useFetch<BudgetView>("/api/ai/budget");

  return (
    <section className="ui-settings-section" id="budget">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-text-primary">Your AI budget today</h2>
          <p className="-mt-1 text-sm text-text-secondary">
            What you can still ask, on every source Loki answers from. Only chat on the free pool
            draws on your share; your own keys never do.
          </p>
        </div>
        <button
          type="button"
          onClick={refetch}
          className="ui-btn-ghost min-h-8 shrink-0 gap-1.5 px-2 text-xs"
          disabled={loading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading your budget
        </p>
      )}

      {/* What failed AND what it does not mean: "could not look" is not "nothing left". */}
      {error && !data && (
        <p className="ui-error text-sm">
          Could not read your budget just now — this says nothing about what is left.
        </p>
      )}

      {data && (
        <>
          {data.ownKeys.map((k) => (
            <OwnKeySource key={`${k.vendor}/${k.model}`} source={k} />
          ))}
          <FreePoolSource
            pool={data.freePool}
            models={data.models}
            ownKeys={data.ownKeys}
            meaning={data.meaning}
          />
          <Actions actions={data.meaning.actions} onChanged={refetch} />
          <WhatThisMeans explain={data.meaning.explain} />
        </>
      )}
    </section>
  );
}

/**
 * The levers, as buttons. A number without a way to act on it is decoration;
 * these are the ways. "Let Auto spend less" is performed here (one PUT, the
 * same one Settings → AI's routing panel makes); the rest are places to go.
 */
function Actions({ actions, onChanged }: { actions: BudgetAction[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (actions.length === 0) return null;

  async function thrifty() {
    setBusy("thrifty");
    setError(null);
    try {
      await ownModelRequest("/api/settings/model/routing", "PUT", { stance: "thrifty" });
      onChanged();
    } catch {
      setError("Couldn't change how Auto spends — try it from the routing panel below.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {actions.map((a) => (
        <div key={a.id} className="ui-budget-action">
          {a.href ? (
            <Link href={a.href} className="ui-btn-secondary min-h-9 shrink-0 px-3 text-xs">
              {a.label} →
            </Link>
          ) : a.id === "thrifty" ? (
            <button
              type="button"
              onClick={thrifty}
              disabled={busy !== null}
              className="ui-btn-secondary min-h-9 shrink-0 px-3 text-xs"
            >
              {busy === "thrifty" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
              {a.label}
            </button>
          ) : (
            <span className="ui-badge shrink-0">{a.label}</span>
          )}
          <span className="ui-quota-consequence">{a.why}</span>
        </div>
      ))}
      {error && <p className="ui-error text-xs">{error}</p>}
    </div>
  );
}

/**
 * Each number in plain words, one tap away. The meters above answer "how
 * much"; this answers "of what, and why does it move" — the question a
 * person has the first time they see a share that was 40 answers yesterday
 * and is 12 today.
 */
function WhatThisMeans({ explain }: { explain: BudgetView["meaning"]["explain"] }) {
  return (
    <details className="ui-disclosure">
      <summary className="ui-disclosure-summary">
        <ChevronDown className="ui-disclosure-chevron" aria-hidden="true" />
        <span>What these numbers mean</span>
      </summary>
      <div className="ui-disclosure-body space-y-3">
        {explain.map((e) => (
          <div key={e.title}>
            <p className="text-sm font-medium text-text-primary">{e.title}</p>
            <p className="text-xs leading-relaxed text-text-secondary">{e.body}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function FreePoolSource({
  pool,
  models,
  ownKeys,
  meaning,
}: {
  pool: FreePoolBudget;
  models: BudgetView["models"];
  ownKeys: OwnKeyBudget[];
  meaning: BudgetView["meaning"];
}) {
  const tone =
    pool.state === "spent" || pool.state === "pool-spent"
      ? "ui-budget-source-spent"
      : pool.state === "paced" || pool.usedLevel >= 0.8
        ? "ui-budget-source-low"
        : "";
  const noteFor = new Map(models.map((m) => [m.id, m.note]));

  return (
    <div className={`ui-budget-source ${tone}`}>
      <div className="ui-quota-row-head">
        <Gauge className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="ui-quota-provider">Shared free pool</span>
        <span className="ui-quota-state">{poolStateLabel(pool)}</span>
      </div>

      {pool.state !== "none" && (
        <>
          <div className="ui-budget-hero">
            <span className="ui-budget-number">~{pool.answersNow.toLocaleString("en-US")}</span>
            <span className="ui-budget-unit">
              answer{pool.answersNow === 1 ? "" : "s"} now
              {pool.answersToday !== pool.answersNow && (
                <> · {pool.answersToday.toLocaleString("en-US")} by the end of the day</>
              )}
            </span>
          </div>
          {/* The bar is the SHARE, used: the one quantity that only moves one way
              through a day, so a glance reads the same at 09:00 and 21:00. */}
          <div className="ui-quota-track" role="presentation">
            <span
              className={pool.state === "spent" ? "ui-quota-fill-spent" : "ui-quota-fill"}
              style={{ width: `${Math.round(pool.usedLevel * 100)}%` }}
            />
          </div>
          <p className="ui-quota-detail">
            {pool.spentTokens.toLocaleString("en-US")} of ~
            {pool.shareTokens.toLocaleString("en-US")} tokens used ·{" "}
            {pool.activeUsers === 1 ? "only you" : `${pool.activeUsers} people`} drawing today ·
            counted at {pool.measured ? "your own" : "about"}{" "}
            {pool.tokensPerAnswer.toLocaleString("en-US")} tokens an answer
          </p>
          {/* The forecast and the week: what the meter is NOT saying. "57%
              used" is true at 09:00 and at 21:00 and means opposite things;
              the pace line is the difference. */}
          {meaning.pace && <p className="ui-quota-detail">{meaning.pace}</p>}
          {meaning.week && <p className="ui-quota-detail">{meaning.week.line}</p>}
        </>
      )}

      <p className="text-sm text-text-primary">{pool.line}</p>
      <p className="ui-quota-consequence">
        {pool.consequence}
        {ownKeys.length === 0 && pool.state !== "none" && (
          <>
            {" "}
            <Link
              href={MODEL_STORE_PATH}
              className="text-accent-text underline-offset-2 hover:underline"
            >
              Bring one →
            </Link>
          </>
        )}
      </p>

      {pool.models.length > 0 && (
        <ul className="space-y-1" aria-label="Models in the free pool">
          {pool.models.map((id) => {
            const [provider, ...rest] = id.split("/");
            const model = rest.join("/");
            const note = noteFor.get(id) ?? null;
            return (
              <li key={id} className="ui-budget-model">
                <span className="text-text-primary">{describeChatModel(model).name}</span>
                <span className="text-text-muted">{provider}</span>
                {note && <span className="ui-budget-model-note">{note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function poolStateLabel(pool: FreePoolBudget): string {
  switch (pool.state) {
    case "ok":
      return "available";
    case "paced":
      return `more ${pool.unlocksIn ?? "soon"}`;
    case "spent":
      return "your share is spent";
    case "pool-spent":
      return "spent for everyone";
    case "none":
      return "not on this server";
  }
}

function OwnKeySource({ source }: { source: OwnKeyBudget }) {
  return (
    <div className="ui-budget-source">
      <div className="ui-quota-row-head">
        <KeyRound className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="ui-quota-provider">{source.label}</span>
        <span className="ui-quota-model">{source.model}</span>
        <span className="ui-quota-state">no cap from Loki</span>
      </div>
      <p className="text-sm text-text-primary">{source.line}</p>
      <p className="ui-quota-consequence">
        {source.consequence}
        {source.billingUrl && (
          <>
            {" "}
            <a
              href={source.billingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline"
            >
              Billing at {source.label}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </>
        )}
      </p>
    </div>
  );
}
