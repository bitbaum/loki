import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { NoScreenDemo } from "@/components/public/NoScreenDemo";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import {
  NO_SCREEN_APP_PATH,
  NO_SCREEN_COMMANDS,
  NO_SCREEN_ESSAY_PATH,
  NO_SCREEN_PAGE,
} from "@/config/no-screen";

export const metadata = {
  title: "No-screen mode",
  description: NO_SCREEN_PAGE.lede,
};

const WHO_LABEL = { you: "You", loki: "Loki", later: "Later, unasked" } as const;

/**
 * /no-screen — the public page for the mode. The sample exchange is the
 * briefing composer's own sentences (lib/voice/briefing), so what the page
 * promises is what the headphones say.
 */
export default function NoScreenPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-hero-fold ui-public-hero-fold-compact">
        <div className="w-full max-w-5xl">
          <div className="ui-public-eyebrow">{NO_SCREEN_PAGE.eyebrow}</div>
          <h1 className="ui-public-hero-title mt-4 sm:mt-6">{NO_SCREEN_PAGE.title}</h1>
          <p className="ui-public-hero-lede">{NO_SCREEN_PAGE.lede}</p>
          <div className="ui-public-hero-actions">
            <Link href={NO_SCREEN_APP_PATH} className="ui-public-cta">
              {NO_SCREEN_PAGE.cta}
            </Link>
            <Link href={NO_SCREEN_ESSAY_PATH} className="ui-public-cta-ghost">
              {NO_SCREEN_PAGE.essayCta}
            </Link>
          </div>
          <p className="ui-public-hero-sublede">{NO_SCREEN_PAGE.ctaNote}</p>

          <NoScreenDemo />

          <div className="ui-public-ear">
            {NO_SCREEN_PAGE.sample.map((turn, i) => (
              <div key={i} className={`ui-public-ear-turn ui-public-ear-turn-${turn.who}`}>
                <span className="ui-public-ear-who">{WHO_LABEL[turn.who]}</span>
                <p className="ui-public-ear-line">{turn.line}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container-mid">
          <h2 className="ui-public-eyebrow">HOW IT WORKS</h2>
          <div className="ui-public-section-gap ui-public-howto">
            {NO_SCREEN_PAGE.steps.map((step, i) => (
              <section key={step.title} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="ui-public-howto-title">{step.title}</h3>
                <p className="ui-public-howto-body">{step.body}</p>
              </section>
            ))}
          </div>

          <div className="mt-12 grid gap-4 sm:mt-16 md:grid-cols-2">
            <section className="ui-public-feature-card">
              <h3 className="ui-public-feature-title">What you hear without asking</h3>
              <ul className="mt-3 space-y-2">
                {NO_SCREEN_PAGE.hears.map((line) => (
                  <li key={line} className="ui-public-prose-li">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
            <section className="ui-public-feature-card">
              <h3 className="ui-public-feature-title">{NO_SCREEN_PAGE.button.title}</h3>
              <p className="ui-public-feature-body mt-3">{NO_SCREEN_PAGE.button.body}</p>
            </section>
          </div>
        </div>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid">
          <h2 className="ui-public-eyebrow">WHY IT IS PLEASANT TO LISTEN TO</h2>
          <p className="ui-public-lede mt-4 max-w-2xl">
            A voice is a slow channel, and an AI voice that talks too much is the fastest way to
            make someone take the headphones out. Every part of this is built to be left on for an
            hour.
          </p>
          <div className="mt-10 space-y-10 sm:mt-14 sm:space-y-12">
            {NO_SCREEN_PAGE.listen.map((item, i) => (
              <div key={item.title} className="flex flex-col gap-2 sm:flex-row sm:gap-12">
                <div className="ui-public-step-num sm:pt-2">{String(i + 1).padStart(2, "0")}</div>
                <div className="flex-1">
                  <h3 className="ui-public-display-md">{item.title}</h3>
                  <p className="ui-public-body-lg mt-3 max-w-2xl">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container-mid">
          <h2 className="ui-public-eyebrow">WHAT YOU CAN SAY</h2>
          <p className="ui-public-lede mt-4 max-w-2xl">
            Thirteen things, and every other sentence is a question for Loki. The same list is read
            to you when you say &ldquo;what can I say&rdquo;.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NO_SCREEN_COMMANDS.map((c) => (
              <section key={c.kind} className="ui-public-feature-card">
                <h3 className="ui-public-feature-title">&ldquo;{c.say[0]}&rdquo;</h3>
                <p className="ui-public-feature-body">{c.does}</p>
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid">
          <h2 className="ui-public-eyebrow">WHAT IT IS NOT, YET</h2>
          <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
            {NO_SCREEN_PAGE.limits.map((limit) => (
              <section key={limit.title} className="max-w-2xl">
                <h3 className="ui-public-display-md">{limit.title}</h3>
                <p className="ui-public-body-lg mt-3">{limit.body}</p>
              </section>
            ))}
          </div>
          <p className="ui-public-meta mt-12">
            How it is built, and where it fails:{" "}
            <Link href={NO_SCREEN_ESSAY_PATH} className="ui-public-link">
              the essay →
            </Link>
          </p>
        </div>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
