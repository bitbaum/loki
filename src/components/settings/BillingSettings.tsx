import { Bitcoin, Check, KeyRound, ListChecks } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { PRICING_BILLING_NOTE, PRICING_CURRENCY, PRICING_PLANS } from "@/config/plans";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import { passDaysLeft } from "@/lib/plan-pass";
import { planCheckoutPath } from "@/lib/plan-reservation";
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
  /** The plan this person reserved while payments are not open, if any. */
  reservedPlan: Plan | null;
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
export function BillingSettings({
  plan,
  planStatus,
  planExpiresAt,
  grants,
  payUrls,
  reservedPlan,
}: BillingView) {
  const priced = PRICING_PLANS.filter((p) => p.priceMonthly !== null && p.priceMonthly > 0);
  const buyable = priced.filter((p) => payUrls[p.key]);
  const expiry = planExpiresAt ? new Date(planExpiresAt) : null;
  const daysLeft = passDaysLeft(expiry);

  const planLine = (
    <>
      <span className="font-medium text-text-primary">{PLAN_LABEL[plan]}</span>
      {planStatus === "past_due" && (
        <span className="text-status-warning"> · payment past due</span>
      )}
      {expiry && daysLeft !== null && (
        <>
          {" · "}
          {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "ended"}, until{" "}
          {expiry.toLocaleDateString()}
        </>
      )}
    </>
  );

  return (
    <section className="ui-settings-section">
      <Section title="Your plan">
        <p className="ui-settings-lede">You are on {planLine}</p>
        <List aria-label="Your plan">
          <ListRow
            href={OWN_MODEL_SETTINGS_PATH}
            icon={KeyRound}
            title="Use your own key"
            secondary="A stronger model, paid to your provider"
            chevron
          />
          <ListRow href="/pricing" icon={ListChecks} title="See plans" chevron />
        </List>
      </Section>

      <Section title="Get more room">
        <p className="ui-settings-lede">
          A plan lifts the project limit and adds a monthly allowance of answers with no daily wait.
          Paid in Bitcoin on OrangeCat, a month at a time; nothing renews by itself.
        </p>
        {buyable.length > 0 ? (
          <List aria-label="Plans you can buy">
            {buyable.map((p) => (
              <ListRow
                key={p.key}
                href={payUrls[p.key]}
                external
                icon={Bitcoin}
                title={`${plan === p.key && daysLeft !== null && daysLeft > 0 ? "Extend" : "Subscribe to"} ${p.name}`}
                secondary="A month, paid in Bitcoin"
                trailing={`${PRICING_CURRENCY} ${p.priceMonthly}`}
              />
            ))}
          </List>
        ) : priced.length > 0 ? (
          <>
            {reservedPlan && (
              <p className="ui-settings-lede">
                You reserved {PLAN_LABEL[reservedPlan]}. Your place is kept and nothing is charged
                until checkout opens for your account.
              </p>
            )}
            <List aria-label="Plans you can reserve">
              {priced.map((p) => (
                <ListRow
                  key={p.key}
                  href={planCheckoutPath(p.key)}
                  icon={Bitcoin}
                  title={`${reservedPlan === p.key ? "Reserved" : "Reserve"} ${p.name}`}
                  trailing={`${PRICING_CURRENCY} ${p.priceMonthly}`}
                  chevron
                />
              ))}
            </List>
          </>
        ) : (
          <p className="ui-settings-lede">
            Prices are not announced yet — every plan is free until they are.
          </p>
        )}
      </Section>

      {grants.length > 0 && (
        <Section title="Passes">
          <List aria-label="Passes">
            {grants.map((g) => (
              <ListRow
                key={g.id}
                icon={Check}
                title={PLAN_LABEL[g.plan]}
                secondary={`${g.periodDays} days · until ${new Date(g.expiresAt).toLocaleDateString()}`}
                trailing={g.amountBtc ? `₿${g.amountBtc}` : "granted"}
              />
            ))}
          </List>
        </Section>
      )}

      <p className="ui-settings-lede">{PRICING_BILLING_NOTE}</p>
    </section>
  );
}
