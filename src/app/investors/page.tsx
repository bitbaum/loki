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
      <div className="ui-public-container-mid pb-12 pt-10 sm:pb-16 sm:pt-16">
        <h1 className="ui-public-page-title">{INVESTORS.headline}</h1>
        <p className="ui-public-lede mt-5 max-w-3xl sm:mt-8">{INVESTORS.thesis}</p>
      </div>

      <section className="ui-public-band ui-public-section" aria-labelledby="why-now">
        <div className="ui-public-container-mid">
          <h2 id="why-now" className="ui-public-h2">
            Why now
          </h2>
          <ol className="ui-public-section-gap">
            {INVESTORS.whyNow.map((point, i) => (
              <li key={i} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="ui-public-body-lg mt-1 max-w-2xl">{point}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container-mid grid gap-y-12 md:grid-cols-2 md:gap-x-16">
          <section aria-labelledby="built">
            <h2 id="built" className="ui-public-h2">
              What we have built
            </h2>
            <p className="ui-public-body-lg mt-4">{INVESTORS.built}</p>
          </section>
          <section aria-labelledby="traction">
            <h2 id="traction" className="ui-public-h2">
              Traction
            </h2>
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
          </section>
        </div>
      </div>

      <section className="ui-public-band ui-public-section" aria-labelledby="the-ask">
        <div className="ui-public-container-mid">
          <h2 id="the-ask" className="ui-public-h2">
            The ask
          </h2>
          <p className="ui-public-body-lg mt-4 max-w-2xl">{INVESTORS.ask}</p>
        </div>
      </section>

      {/* Investor-specific closing CTA — a "Begin." sign-up pitch is the wrong
          ask for this audience; the next step here is a conversation. */}
      <div className="ui-public-container-mid ui-public-section border-t border-border-subtle text-center">
        <h2 className="ui-public-h2">Talk to the founder.</h2>
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
