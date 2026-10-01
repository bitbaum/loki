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
      <div className="ui-public-hero-fold ui-public-hero-fold-compact">
        <div className="w-full max-w-5xl">
          <div className="ui-public-eyebrow">{MISSION.eyebrow}</div>
          <h1 className="ui-public-hero-title mt-4 sm:mt-6">{MISSION.statement}</h1>
        </div>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-body-lg mx-auto max-w-2xl space-y-6 px-4 sm:space-y-8 sm:px-6">
          {MISSION.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container-mid">
          <div className="ui-public-eyebrow">{PHILOSOPHY.eyebrow}</div>
          <h2 className="ui-public-display-lg mt-3 sm:mt-4">The rules we keep</h2>
          <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">{PHILOSOPHY.lede}</p>

          {/* The numbered rail becomes a numbered badge above each principle on
              a phone, where a gutter plus a number left too little measure. */}
          <div className="mt-10 space-y-10 sm:mt-16 sm:space-y-14">
            {PHILOSOPHY.values.map((value, i) => (
              <div key={value.name} className="flex flex-col gap-2 sm:flex-row sm:gap-12">
                <div className="ui-public-step-num sm:pt-2">{String(i + 1).padStart(2, "0")}</div>
                <div className="flex-1">
                  <h3 className="ui-public-display-md">{value.name}</h3>
                  <p className="ui-public-body-lg mt-3 max-w-2xl sm:mt-4">{value.description}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="ui-public-meta mt-12 max-w-2xl sm:mt-20">{PHILOSOPHY.closer}</p>
        </div>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
