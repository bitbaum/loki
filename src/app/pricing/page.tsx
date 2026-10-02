import Link from "next/link";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { orangeCatPayUrl } from "@/lib/oc-pay";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import {
  PRICING_PLANS,
  PRICING_INCLUDED,
  PRICING_CURRENCY,
  PRICING_BILLING_NOTE,
  type PricingPlan,
} from "@/config/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Loki is free while prices are not announced. Paid plans will add room for more projects.",
};

/**
 * Public pricing. Honest about billing state: a paid CTA only appears when a
 * rail can actually take the money — never a dead "Buy" button.
 *
 * The rail is Bitcoin via OrangeCat (orangeCatPayUrl), which needs no merchant
 * account. A Stripe branch used to sit ahead of it, permanently unreachable:
 * isStripeReady() was false in every environment, so every visitor already got
 * the path below. Removing it changed no rendered output.
 */
export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  // Resolve each plan's CTA target for the current state (signed in? BTC rail live?).
  function ctaFor(plan: PricingPlan): { href: string; label: string } {
    if (plan.key === "free") {
      return signedIn
        ? { href: ROUTES.APP_HOME, label: `Open ${APP_NAME}` }
        : { href: ROUTES.SIGN_UP, label: plan.cta };
    }
    // Price to be announced — no checkout rail may sell this tier yet.
    if (plan.priceMonthly === null) {
      return signedIn
        ? { href: ROUTES.APP_HOME, label: `Open ${APP_NAME}` }
        : { href: ROUTES.SIGN_UP, label: "Start free" };
    }
    // The Bitcoin/OrangeCat rail needs no merchant account. If this tier has
    // an OC pass configured, offer it.
    const btc = orangeCatPayUrl(plan.key);
    if (btc) {
      return { href: btc, label: "Pay in Bitcoin" };
    }
    // Neither rail live yet — start free, upgrade in-app later.
    return signedIn
      ? { href: ROUTES.APP_HOME, label: `Open ${APP_NAME}` }
      : { href: ROUTES.SIGN_UP, label: "Start free" };
  }

  // A plan with a price (Free included) can be started today; one without is
  // announced, not sold — no checkout rail may sell it yet.
  const available = PRICING_PLANS.filter((p) => p.priceMonthly !== null);
  const later = PRICING_PLANS.filter((p) => p.priceMonthly === null);

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-12 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="ui-public-eyebrow">Pricing</div>
          <h1 className="ui-public-display-md mt-3 sm:mt-4">
            Your agents, your keys. Loki is free for now.
          </h1>
          <p className="ui-public-section-lede mx-auto mt-4 sm:mt-5">
            Your agents run on your own computer with the Fleet Runner app, or on Loki&apos;s cloud
            builder where your account has it. Loki is the one place you start, watch and check
            their work. The plans differ only in how many projects you can have.
          </p>
        </div>

        {/* What exists today gets a card and the one button; the plans that have
            no price yet get one line each. Four equal cards, three of them
            "Price to be announced · Start free", asked the reader to compare
            options that are not on sale (2026-10-01). */}
        <div className="ui-public-section-gap mx-auto grid max-w-md gap-3">
          {available.map((plan) => {
            const cta = ctaFor(plan);
            return (
              <div
                key={plan.key}
                className={`ui-public-price-card${plan.featured ? " ui-public-price-card-featured" : ""}`}
              >
                <h2 className="text-lg font-semibold text-text-primary">{plan.name}</h2>

                <div className="mt-4 flex items-baseline gap-1.5">
                  {plan.priceMonthly === null ? (
                    <span className="text-lg font-semibold text-text-secondary">
                      Price to be announced
                    </span>
                  ) : (
                    <>
                      <span className="ui-public-price-amount">
                        {plan.priceMonthly === 0
                          ? "Free"
                          : `${PRICING_CURRENCY} ${plan.priceMonthly}`}
                      </span>
                      {plan.priceMonthly > 0 && (
                        <span className="text-sm text-text-secondary">/ mo</span>
                      )}
                    </>
                  )}
                </div>

                <p className="mt-3 text-sm leading-snug text-text-secondary">{plan.tagline}</p>

                <ul className="mt-5 flex flex-col gap-2.5">
                  {plan.highlights.map((h) => (
                    <li key={h} className="ui-public-price-feature">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-positive" aria-hidden />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                {/* mt-auto on the wrapper, so on a phone — where the cards
                    stack and their feature lists differ in length — every CTA
                    still sits on the card's bottom edge. */}
                <div className="mt-auto pt-6">
                  <Link
                    href={cta.href}
                    className={`w-full text-center ${plan.featured ? "ui-public-cta" : "ui-public-cta-ghost"}`}
                  >
                    {cta.label}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {later.length > 0 && (
          <section className="mx-auto mt-8 max-w-2xl sm:mt-12" aria-labelledby="later-plans">
            <h2 id="later-plans" className="ui-public-eyebrow text-center">
              Later plans — price to be announced
            </h2>
            <ul className="mt-4 divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {later.map((plan) => (
                <li
                  key={plan.key}
                  className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <span className="shrink-0 font-semibold text-text-primary sm:w-24">
                    {plan.name}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {plan.tagline}
                    {plan.highlights[0] && (
                      <span className="text-text-tertiary"> · {plan.highlights[0]}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-text-secondary sm:mt-8">
          {PRICING_BILLING_NOTE}
        </p>

        {/* Every plan includes everything — stated once, honestly, rather
            than faked as per-tier gates the product doesn't enforce. */}
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-border-subtle bg-surface-base p-5 sm:mt-16 sm:p-8">
          <div className="ui-public-eyebrow">Every plan includes</div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PRICING_INCLUDED.map((item) => (
              <li key={item} className="ui-public-price-feature">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-positive" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </PublicSurface>
  );
}
