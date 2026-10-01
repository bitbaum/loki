import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { HOW_DEEP, HOW_IT_WORKS_INTRO, HOW_SHORT, type HowSection } from "@/config/how-it-works";

export const metadata = {
  title: "How it works",
  description: HOW_IT_WORKS_INTRO.lede,
};

function Section({ section, level }: { section: HowSection; level: "plain" | "deep" }) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <h3 className={level === "plain" ? "ui-public-display-md" : "ui-public-section-title"}>
        {section.title}
      </h3>
      <p className="ui-public-body-lg mt-3 max-w-2xl">{section.lede}</p>
      {section.points && section.points.length > 0 && (
        <ul className="mt-4 max-w-2xl space-y-2.5">
          {section.points.map((point) => (
            <li key={point} className="ui-public-prose-li">
              {point}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-20">
        <div className="ui-public-eyebrow">{HOW_IT_WORKS_INTRO.eyebrow}</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">{HOW_IT_WORKS_INTRO.title}</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">{HOW_IT_WORKS_INTRO.lede}</p>

        <nav className="ui-public-jumpbar mt-8" aria-label="On this page">
          <a href="#short" className="ui-public-jumpbar-link">
            The short version
          </a>
          <a href="#deep" className="ui-public-jumpbar-link">
            Under the hood
          </a>
        </nav>

        <h2 id="short" className="ui-public-eyebrow mt-14 scroll-mt-24 sm:mt-20">
          THE SHORT VERSION
        </h2>
        <div className="mt-6 space-y-12 sm:space-y-16">
          {HOW_SHORT.map((section) => (
            <Section key={section.id} section={section} level="plain" />
          ))}
        </div>
      </div>

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container-mid">
          <h2 id="deep" className="ui-public-eyebrow scroll-mt-24">
            UNDER THE HOOD
          </h2>
          <p className="ui-public-lede mt-4 max-w-2xl">
            For builders who want the machinery. The full design, with the reasoning behind it, is
            in the{" "}
            <Link href="/whitepaper" className="ui-public-link">
              whitepaper
            </Link>
            ; setup steps are in the{" "}
            <Link href="/docs" className="ui-public-link">
              docs
            </Link>
            .
          </p>
          <div className="mt-10 space-y-12 sm:mt-14 sm:space-y-14">
            {HOW_DEEP.map((section) => (
              <Section key={section.id} section={section} level="deep" />
            ))}
          </div>
          <p className="ui-public-meta mt-12">
            Compared with other tools?{" "}
            <Link href="/compare" className="ui-public-link">
              See the comparison →
            </Link>
          </p>
        </div>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
