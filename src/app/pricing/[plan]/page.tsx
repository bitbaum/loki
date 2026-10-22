import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { ReservePlanButton } from "@/components/billing/ReservePlanButton";
import { ROUTES } from "@/config/auth";
import { PRICING_CURRENCY, PRICING_PLANS } from "@/config/plans";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import { planCheckout, planCheckoutPath } from "@/lib/plan-reservation";
import { getPlanReservation } from "@/db/queries/plan-reservations";

export const metadata: Metadata = { title: "Choose a plan" };

/**
 * One paid plan, up to the moment of paying.
 *
 * Everything a buyer needs before money changes hands is here: the price, what
 * it adds, and the one button. While payments are not open (no OrangeCat pass
 * for the plan, lib/oc-pay.ts) that button reserves the plan and says plainly
 * that nothing is charged; once the pass exists it pays instead — the same page.
 * A person who wants more AI today is offered the way that works today: their
 * own key.
 */
export default async function PlanCheckoutPage({ params }: { params: Promise<{ plan: string }> }) {
  const { plan: key } = await params;
  const plan = PRICING_PLANS.find((p) => p.key === key);
  if (!plan) notFound();
  const checkout = planCheckout(plan);
  if (checkout.kind === "none") notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const reservation = userId ? await getPlanReservation(userId).catch(() => null) : null;
  const here = planCheckoutPath(plan.key);

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-12 sm:py-20">
        <div className="ui-public-price-card mx-auto max-w-md">
          <div className="ui-public-eyebrow">{plan.name}</div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="ui-public-price-amount">{`${PRICING_CURRENCY} ${plan.priceMonthly}`}</span>
            <span className="text-sm text-text-secondary">/ month</span>
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

          <div className="mt-6 flex flex-col gap-3">
            {checkout.kind === "pay" ? (
              <a href={checkout.url} className="ui-public-cta w-full text-center">
                Pay in Bitcoin
              </a>
            ) : userId ? (
              <ReservePlanButton
                plan={plan.key}
                planName={plan.name}
                reservedPlan={reservation?.plan ?? null}
                reservedAt={reservation?.updatedAt.toISOString() ?? null}
              />
            ) : (
              <Link
                href={`${ROUTES.SIGN_UP}?callbackUrl=${encodeURIComponent(here)}`}
                className="ui-public-cta w-full text-center"
              >
                Create an account to reserve {plan.name}
              </Link>
            )}
            {checkout.kind === "reserve" && (
              <p className="text-sm text-text-secondary">
                Reserving charges nothing and commits you to nothing: your place is kept, you hear
                from us the day checkout opens for your account, and you can cancel any time.
              </p>
            )}
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-md text-center text-sm text-text-secondary">
          Want more answers today?{" "}
          <Link
            href={OWN_MODEL_SETTINGS_PATH}
            className="ui-public-link text-text-primary underline underline-offset-2"
          >
            Add your own model key
          </Link>{" "}
          — it works now, on every plan, and your provider bills you directly.
        </p>
        <p className="mx-auto mt-3 max-w-md text-center text-sm">
          <Link href="/pricing" className="ui-public-link-standalone min-h-11">
            See all plans
          </Link>
        </p>
      </main>
    </PublicSurface>
  );
}
