import Link from "next/link";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { planCheckout, planCheckoutPath } from "@/lib/plan-reservation";
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
    "Start free. Paid plans add room for more projects and a monthly allowance of Loki answers.",
};

/**
 * Public pricing. Honest about billing state: "Pay in Bitcoin" appears only
 * when the OrangeCat pass for that plan exists (lib/oc-pay.ts); until then a
 * paid plan's button opens its own page (/pricing/<plan>), where it is
 * reserved and nothing is charged. Never a dead "Buy" button.
 */
export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  function ctaFor(plan: PricingPlan): { href: string; label: string } {
    if (plan.key === "free") {
      return signedIn
        ? { href: ROUTES.APP_HOME, label: `Open ${APP_NAME}` }
        : { href: ROUTES.SIGN_UP, label: plan.cta };
    }
    const checkout = planCheckout(plan);
    if (checkout.kind === "pay") return { href: checkout.url, label: "Pay in Bitcoin" };
    if (checkout.kind === "reserve") {
      return { href: planCheckoutPath(plan.key), label: `Reserve ${plan.name}` };
    }
    // Price to be announced — nothing may sell or reserve this tier yet.
    return signedIn
      ? { href: ROUTES.APP_HOME, label: `Open ${APP_NAME}` }
      : { href: ROUTES.SIGN_UP, label: "Start free" };
  }

  // A plan with a price (Free included) gets a card; one without is
  // announced, not sold, and gets one line.
  const available = PRICING_PLANS.filter((p) => p.priceMonthly !== null);
  const later = PRICING_PLANS.filter((p) => p.priceMonthly === null);

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-12 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="ui-public-page-title">Your agents, your keys. Start free.</h1>
          <p className="ui-public-body-lg mx-auto mt-4 sm:mt-5">
            Your agents run on your own computer with the Fleet Runner app, or on Loki&apos;s cloud
            runner where your account has it. Loki is the one place you start, watch and check their
            work. The plans differ in how many projects you can have and how many answers
            Loki&apos;s own chat gives you each month.
          </p>
        </div>

        {/* What exists today gets a card and the one button; the plans that have
            no price yet get one line each. Four equal cards, three of them
            "Price to be announced · Start free", asked the reader to compare
            options that are not on sale (2026-10-01). */}
        <div
          className={`ui-public-section-gap mx-auto grid gap-3 ${available.length > 1 ? "max-w-6xl sm:grid-cols-2 lg:grid-cols-4" : "max-w-md"}`}
        >
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
                      {/* The free plan is NAMED "Free", so a price of "Free" printed
                          the same word twice, one above the other (2026-10-04).
                          A number answers the question a price is there for. */}
                      <span className="ui-public-price-amount">
                        {`${PRICING_CURRENCY} ${plan.priceMonthly}`}
                      </span>
                      <span className="text-sm text-text-secondary">/ mo</span>
                    </>
                  )}
                </div>

                <p className="mt-3 text-sm leading-snug text-text-secondary">{plan.tagline}</p>

                <ul className="mt-5 flex flex-col gap-2.5">
                  {plan.highlights.map((h) => (
                    <li key={h} className="ui-public-price-feature">
                      <Check className="ui-public-price-check" aria-hidden />
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
            <h2 id="later-plans" className="ui-public-h3">
              Later plans — price to be announced
            </h2>
            <ul className="mt-2 divide-y divide-border-subtle border-y border-border-subtle">
              {later.map((plan) => (
                <li
                  key={plan.key}
                  className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-4"
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
        <section className="mx-auto mt-12 max-w-2xl sm:mt-16" aria-labelledby="every-plan">
          <h2 id="every-plan" className="ui-public-h3">
            Every plan includes
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PRICING_INCLUDED.map((item) => (
              <li key={item} className="ui-public-price-feature">
                <Check className="ui-public-price-check" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </PublicSurface>
  );
}
