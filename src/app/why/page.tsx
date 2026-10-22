import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { MISSION, PHILOSOPHY } from "@/config/marketing-content";

export const metadata = {
  title: "Why Loki",
  description: MISSION.statement,
};

/**
 * Why Loki — the mission and the principles on one page.
 *
 * They used to be two pages (/mission, /philosophy) plus throughlines on the
 * roadmap and a thesis on /investors, restating the same three ideas and
 * contradicting each other ("autonomy is a dial" vs "a switch"; local models
 * "first-class" vs "where this is going"). One page, one set of claims.
 */
export default function WhyPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid pb-12 pt-10 sm:pb-16 sm:pt-16">
        <h1 className="ui-public-page-title">{MISSION.statement}</h1>
        <div className="ui-public-body-lg mt-8 max-w-2xl space-y-6 sm:mt-10">
          {MISSION.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>

      <section className="ui-public-band ui-public-section" aria-labelledby="rules-title">
        <div className="ui-public-container-mid">
          <h2 id="rules-title" className="ui-public-h2">
            The rules we keep
          </h2>
          <ol className="ui-public-section-gap">
            {PHILOSOPHY.values.map((value, i) => (
              <li key={value.name} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="ui-public-howto-title">{value.name}</h3>
                <p className="ui-public-howto-body max-w-2xl">{value.description}</p>
              </li>
            ))}
          </ol>
          <p className="ui-public-meta mt-6 max-w-2xl">{PHILOSOPHY.closer}</p>
        </div>
      </section>

      <FinalCta />
    </PublicSurface>
  );
}
