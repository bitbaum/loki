import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { INVESTORS, INVESTOR_DETAILS } from "@/config/marketing-content";
import { getHeroFleetSnapshot, type HeroFleetSnapshot } from "@/db/queries/public-fleet";

export const metadata = {
  title: "For Investors",
  description: INVESTORS.thesis,
};

export default async function InvestorsPage() {
  // Same real data source as the homepage hero: the SHOWCASE tier — projects
  // whose owner consented and the operator featured — plus fleet-wide totals.
  // No longer "the founder's actual fleet": an investor should see how busy
  // Loki is across its tenants, which is also the number that means anything.
  // Degrades to nothing rather than fake numbers.
  const fleet: HeroFleetSnapshot = await getHeroFleetSnapshot().catch(() => ({
    isLive: false,
    projects: [],
    metrics: [],
  }));

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-24 lg:py-32">
        <div className="ui-public-eyebrow">{INVESTORS.eyebrow}</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">{INVESTORS.headline}</h1>
        <p className="ui-public-lede mt-5 max-w-3xl sm:mt-8">{INVESTORS.thesis}</p>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid">
          <div className="ui-public-eyebrow">WHY NOW</div>
          <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
            {INVESTORS.whyNow.map((point, i) => (
              <div key={i} className="flex flex-col gap-1.5 sm:flex-row sm:gap-8">
                <div className="ui-public-step-num sm:pt-2">{String(i + 1).padStart(2, "0")}</div>
                <p className="ui-public-body-lg max-w-2xl">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid grid gap-y-10 sm:gap-y-16 md:grid-cols-2 md:gap-x-16">
          <div>
            <div className="ui-public-eyebrow">WHAT WE HAVE BUILT</div>
            <p className="ui-public-body-lg mt-4 sm:mt-6">{INVESTORS.built}</p>
          </div>
          <div>
            <div className="ui-public-eyebrow">TRACTION</div>
            {fleet.metrics.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:mt-6 sm:gap-6">
                {fleet.metrics.map((metric) => (
                  <div key={metric.label}>
                    <div className="ui-public-display-md">{metric.value}</div>
                    <div className="ui-public-meta mt-1">{metric.label}</div>
                  </div>
                ))}
              </div>
            )}
            <ul className="mt-5 space-y-3 sm:mt-6 sm:space-y-4">
              {INVESTORS.traction.map((point, i) => (
                <li key={i} className="ui-public-prose-li">
                  <span className="ui-public-prose-bullet" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid">
          <div className="ui-public-eyebrow">THE ASK</div>
          <p className="ui-public-section-lede mt-4 sm:mt-6">{INVESTORS.ask}</p>
        </div>
      </div>

      {/* Investor-specific closing CTA — a "Begin." sign-up pitch is the wrong
          ask for this audience; the next step here is a conversation. */}
      <div className="ui-public-container-mid ui-public-section border-t border-border-subtle text-center">
        <h2 className="ui-public-display-lg">Talk to the founder.</h2>
        <p className="ui-public-meta mx-auto mt-4 max-w-md sm:mt-6">
          Deck {INVESTOR_DETAILS.deck.toLowerCase()}.
        </p>
        <div className="mt-7 sm:mt-10">
          {/* The address is the button. On a phone it is also the one tap that
              opens a mail composer, so it gets full width rather than a pill
              whose label ("cato@orangecat.ch") already fills the row. */}
          <a
            href={`mailto:${INVESTOR_DETAILS.contact}`}
            className="ui-public-cta-lg w-full break-all sm:w-auto"
          >
            {INVESTOR_DETAILS.contact}
          </a>
        </div>
      </div>
    </PublicSurface>
  );
}
