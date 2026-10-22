"use client";

import Link from "next/link";
import { ChevronDown, ExternalLink, Gauge, KeyRound, Loader2, Ticket } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import type { BudgetView, FreePoolBudget, OwnKeyBudget } from "@/lib/ai/budget-view";
import { describeChatModel } from "@/lib/loki/models";
import { MODEL_STORE_PATH } from "@/lib/own-model-path";
import { SettingsRefresh, SettingsSectionHeader } from "./SettingsSectionHeader";

/**
 * "What you have left" — every source Loki can answer from, what is left on
 * each, and the two ways to add more.
 *
 * One list, one row anatomy: the source's name, the sentence that says what
 * is left, the line of what it has cost, the line of what to do about it.
 * The person's own keys come first (they answer first), a paid plan next,
 * the shared free pool last — the same order Loki draws on them. The number
 * is always answers, never a percentage; a bar only where there is a ceiling
 * to draw against.
 *
 * It reads the same view the gate refuses on (`/api/ai/budget`), so the
 * number here and a refusal in the chat can never disagree. Every number
 * states its basis: a measured per-answer cost says "your own", a starting
 * estimate says so, and a vendor that has not reported is "not yet", never
 * "full".
 *
 * Under the list, the two ways to add more brain are equal cells: another
 * provider, or a plan. They are always there, not only when something has
 * run out — the owner's rule (2026-10-21): it should always be easy to add
 * more.
 */
export function AiBudgetSettings() {
  const { data, loading, error, refetch } = useFetch<BudgetView>("/api/ai/budget");

  return (
    <section className="ui-settings-section" id="budget" aria-labelledby="budget-title">
      <SettingsSectionHeader
        id="budget-title"
        title="What you have left"
        lede="Every source Loki answers from, and what is left on each. Your own keys and a plan have no daily limit; only the shared free pool is counted per day."
        action={<SettingsRefresh loading={loading} onClick={refetch} />}
      />

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading your sources
        </p>
      )}

      {/* What failed AND what it does not mean: "could not look" is not "nothing left". */}
      {error && !data && (
        <p className="ui-error text-sm">
          Could not read your sources just now — this says nothing about what is left.
        </p>
      )}

      {data && (
        <>
          <ul className="space-y-3" aria-label="Sources Loki answers from">
            {data.ownKeys.map((k) => (
              <li key={`${k.vendor}/${k.model}`}>
                <OwnKeySource source={k} />
              </li>
            ))}
            {data.plan && (
              <li>
                <PlanSource plan={data.plan} />
              </li>
            )}
            <li>
              <FreePoolSource pool={data.freePool} models={data.models} meaning={data.meaning} />
            </li>
          </ul>
          <AddMore onPlan={data.plan !== null} />
          <WhatThisMeans explain={data.meaning.explain} />
        </>
      )}
    </section>
  );
}

/**
 * The two ways to add more, as equal cells. Both say where they go: the
 * store, where providers are compared and a key is added in one paste; or
 * the plans, where a monthly allowance is bought.
 */
function AddMore({ onPlan }: { onPlan: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link href={MODEL_STORE_PATH} className="ui-btn-secondary min-h-11 w-full">
        Add a provider
      </Link>
      {onPlan ? (
        <a href="#billing" className="ui-btn-secondary min-h-11 w-full">
          Manage plan
        </a>
      ) : (
        <Link href="/pricing" className="ui-btn-secondary min-h-11 w-full">
          Upgrade plan
        </Link>
      )}
    </div>
  );
}

/**
 * Each number in plain words, one tap away. The rows above answer "how
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

function OwnKeySource({ source }: { source: OwnKeyBudget }) {
  return (
    <div className={`ui-budget-source ${source.left?.spent ? "ui-budget-source-spent" : ""}`}>
      <div className="ui-quota-row-head">
        <KeyRound className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="ui-quota-provider">{source.label}</span>
        <span className="ui-quota-model">{source.model}</span>
        <span className="ui-quota-state">no limit from Loki</span>
      </div>
      {/* Three states, never two: the vendor said what is left, the vendor
          said it is refusing, or the vendor has not said — which is not "full". */}
      <p className={source.left?.spent ? "ui-error text-sm" : "ui-budget-left"}>
        {source.left
          ? source.left.line
          : `${source.label} has not reported what is left on your account yet — it shows here as soon as the vendor says so with an answer.`}
      </p>
      <p className="ui-quota-detail">{source.line}</p>
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

function PlanSource({ plan }: { plan: NonNullable<BudgetView["plan"]> }) {
  const spent = plan.answersLeft === 0;
  return (
    <div className={`ui-budget-source ${spent ? "ui-budget-source-low" : ""}`}>
      <div className="ui-quota-row-head">
        <Ticket className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="ui-quota-provider">{plan.name} plan</span>
        <span className="ui-quota-state">
          {spent ? "used for this month" : `${plan.answersLeft.toLocaleString("en-US")} this month`}
        </span>
      </div>
      {/* The bar is the allowance used, so a glance reads the same on the 2nd and the 28th. */}
      <div className="ui-quota-track" role="presentation">
        <span
          className="ui-quota-fill"
          style={{
            width: `${Math.round((1 - plan.answersLeft / Math.max(1, plan.answersMonthly)) * 100)}%`,
          }}
        />
      </div>
      <p className="ui-budget-left">{plan.line}</p>
      <p className="ui-quota-consequence">
        Counted only when the free share is spent, with no daily wait. Starts over on the 1st.
      </p>
    </div>
  );
}

function FreePoolSource({
  pool,
  models,
  meaning,
}: {
  pool: FreePoolBudget;
  models: BudgetView["models"];
  meaning: BudgetView["meaning"];
}) {
  const tone =
    pool.state === "spent" || pool.state === "pool-spent"
      ? "ui-budget-source-spent"
      : pool.state === "paced" || pool.usedLevel >= 0.8
        ? "ui-budget-source-low"
        : "";
  const noteFor = new Map(models.map((m) => [m.id, m.note]));
  const counted = pool.state === "ok" || pool.state === "paced";

  return (
    <div className={`ui-budget-source ${tone}`}>
      <div className="ui-quota-row-head">
        <Gauge className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="ui-quota-provider">Shared free pool</span>
        <span className="ui-quota-state">{poolStateLabel(pool)}</span>
      </div>

      {/* The number is said ONCE: the hero while answers are being counted,
          the sentence when the news is that there are none. Both at once
          said "134 … 267" twice on one card (2026-10-21). */}
      {counted ? (
        <div className="ui-budget-hero">
          <span className="ui-budget-number">
            {pool.state === "paced"
              ? pool.answersToday.toLocaleString("en-US")
              : `~${pool.answersNow.toLocaleString("en-US")}`}
          </span>
          <span className="ui-budget-unit">
            {pool.state === "paced" ? (
              <>
                free answer{pool.answersToday === 1 ? "" : "s"} today · the next one{" "}
                {pool.nextAt ?? "soon"}
              </>
            ) : (
              <>
                free answer{pool.answersNow === 1 ? "" : "s"} now
                {pool.answersToday !== pool.answersNow && (
                  <> · {pool.answersToday.toLocaleString("en-US")} by the end of the day</>
                )}
                {" · full again "}
                {pool.fullAgainAt}
              </>
            )}
          </span>
        </div>
      ) : (
        <p className="ui-budget-left">{pool.line}</p>
      )}

      {pool.state !== "none" && (
        <>
          {/* The bar is the SHARE, used: the one quantity that only moves one way
              through a day, so a glance reads the same at 09:00 and 21:00. */}
          <div className="ui-quota-track" role="presentation">
            <span
              className={
                pool.state === "spent" || pool.state === "pool-spent"
                  ? "ui-quota-fill-spent"
                  : "ui-quota-fill"
              }
              style={{ width: `${Math.round(pool.usedLevel * 100)}%` }}
            />
          </div>
          {/* Every number names its basis. The per-answer cost is this person's
              own mean once there is one, and a starting estimate — said to be
              one — before that. */}
          <p className="ui-quota-detail">
            {pool.spentTokens.toLocaleString("en-US")} of ~
            {pool.shareTokens.toLocaleString("en-US")} tokens of your share used ·{" "}
            {pool.activeUsers === 1 ? "only you" : `${pool.activeUsers} people`} drawing today ·{" "}
            {pool.measured
              ? `counted at your own ${pool.tokensPerAnswer.toLocaleString("en-US")} tokens an answer`
              : `counted at a starting estimate of ${pool.tokensPerAnswer.toLocaleString("en-US")} tokens an answer until Loki has measured yours`}
          </p>
          {meaning.pace && <p className="ui-quota-detail">{meaning.pace}</p>}
          {meaning.week && <p className="ui-quota-detail">{meaning.week.line}</p>}
        </>
      )}

      <p className="ui-quota-consequence">{pool.consequence}</p>

      {pool.models.length > 0 && (
        <details className="ui-disclosure">
          <summary className="ui-disclosure-summary">
            <ChevronDown className="ui-disclosure-chevron" aria-hidden="true" />
            <span>Models in the free pool</span>
            <span className="text-micro text-text-muted">{pool.models.length}</span>
          </summary>
          <ul className="ui-disclosure-body space-y-1" aria-label="Models in the free pool">
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
        </details>
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
