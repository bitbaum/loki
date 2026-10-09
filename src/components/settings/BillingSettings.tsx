import Link from "next/link";
import { Bitcoin, Check } from "lucide-react";
import { PRICING_BILLING_NOTE, PRICING_CURRENCY, PRICING_PLANS } from "@/config/plans";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import { passDaysLeft } from "@/lib/plan-pass";
import type { Plan } from "@/db/schema/users";

const PLAN_LABEL = Object.fromEntries(PRICING_PLANS.map((p) => [p.key, p.name])) as Record<
  Plan,
  string
>;

/** One pass on the ledger, as the settings page shows it (dates as ISO strings). */
export type BillingGrantView = {
  id: string;
  plan: Plan;
  periodDays: number;
  expiresAt: string;
  createdAt: string;
  /** null = granted by hand (a trial, a pass paid outside the rail). */
  amountBtc: string | null;
};

export type BillingView = {
  plan: Plan;
  planStatus: string | null;
  /** When the current pass ends; null on free or an open-ended grant. */
  planExpiresAt: string | null;
  grants: BillingGrantView[];
  /** Bitcoin checkout per priced plan, when the OrangeCat pass exists. */
  payUrls: Partial<Record<Plan, string>>;
};

/**
 * What plan you are on, how long it runs, how to buy more, and the record.
 *
 * Loki has no card rail and no merchant account: a paid plan is a time-boxed
 * PASS paid in Bitcoin on OrangeCat, granted here when the payment settles,
 * and reverted to free by the expiry cron when it lapses. So this screen is
 * built around a date, not a subscription: the pass, when it ends, the button
 * that buys the next month, and every pass that ever landed. A hand grant (a
 * trial, a month given for a bug found) shows on the same list — same
 * ledger, same shape.
 *
 * Both ways to run Loki are named here, because a person who only wants a
 * stronger model does not need a pass: their own key does that for free.
 *
 * No "use client": nothing here has state. It renders inside the client
 * SettingsTabs, so anything server-only (the pay URLs from env, the ledger)
 * arrives as props from the page.
 */
export function BillingSettings({ plan, planStatus, planExpiresAt, grants, payUrls }: BillingView) {
  const priced = PRICING_PLANS.filter((p) => p.priceMonthly !== null && p.priceMonthly > 0);
  const buyable = priced.filter((p) => payUrls[p.key]);
  const expiry = planExpiresAt ? new Date(planExpiresAt) : null;
  const daysLeft = passDaysLeft(expiry);

  return (
    <section className="ui-settings-section">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-text-primary">Your plan</h2>
          <p className="text-sm text-text-tertiary">
            <span className="font-medium text-text-secondary">{PLAN_LABEL[plan]}</span>
            {planStatus === "past_due" && (
              <span className="ml-2 text-xs text-status-warning">· payment past due</span>
            )}
            {expiry && daysLeft !== null && (
              <span className="ml-2 text-xs text-text-tertiary">
                · {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "ended"},
                until {expiry.toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <Link href="/pricing" className="ui-btn-secondary shrink-0 text-sm">
          See plans
        </Link>
      </div>

      {/* Two ways past the free tier, side by side, because they answer
          different wants: a stronger model (your key) or more room (a pass). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle p-3">
          <p className="text-sm font-medium text-text-primary">Want a stronger model?</p>
          <p className="mt-1 text-xs text-text-secondary">
            Add your own key under AI. Loki thinks with the model you pay your provider for, and
            charges nothing for it. Every plan, including Free.
          </p>
          <Link
            href={OWN_MODEL_SETTINGS_PATH}
            className="mt-2 inline-block text-xs text-accent-text"
          >
            Add a key →
          </Link>
        </div>
        <div className="rounded-lg border border-border-subtle p-3">
          <p className="text-sm font-medium text-text-primary">Want more room?</p>
          <p className="mt-1 text-xs text-text-secondary">
            A pass lifts the project limit for a month at a time. Paid in Bitcoin on OrangeCat; it
            lands here when the payment settles, and nothing renews by itself.
          </p>
          {buyable.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {buyable.map((p) => (
                <li key={p.key}>
                  <a
                    href={payUrls[p.key]}
                    className="ui-btn-secondary text-xs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Bitcoin className="h-3.5 w-3.5" aria-hidden="true" />
                    {plan === p.key && daysLeft !== null && daysLeft > 0 ? "Extend" : "Buy"}{" "}
                    {p.name} · {PRICING_CURRENCY} {p.priceMonthly}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-text-muted">
              {priced.length > 0
                ? "Bitcoin checkout is not switched on for this server yet."
                : "Prices are not announced yet — every plan is free until they are."}
            </p>
          )}
        </div>
      </div>

      {grants.length > 0 && (
        <div>
          <p className="ui-micro-label mb-2">Passes</p>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {grants.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-status-positive" aria-hidden="true" />
                <span className="font-medium text-text-primary">{PLAN_LABEL[g.plan]}</span>
                <span className="text-text-secondary">
                  {g.periodDays} days · until {new Date(g.expiresAt).toLocaleDateString()}
                </span>
                <span className="ml-auto text-xs text-text-tertiary">
                  {g.amountBtc ? `₿${g.amountBtc}` : "granted"} ·{" "}
                  {new Date(g.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-text-muted">{PRICING_BILLING_NOTE}</p>
    </section>
  );
}
