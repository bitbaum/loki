import Link from "next/link";
import { APP_NAME } from "@/config/brand";
import { ROUTES } from "@/config/auth";
import { PROBLEMS_SECTION, PROBLEM_SCALES } from "@/config/problems-we-solve";

/**
 * Homepage "What it solves": one person's problems first, then the ones
 * communities share. Each card is problem → what happens in Loki → the page
 * where it happens, and the whole card is the tap target (an <a>), like the
 * other door cards on this page. Copy and links are SSOT in
 * config/problems-we-solve.ts.
 */
export function ProblemsSection({ signedIn }: { signedIn: boolean }) {
  return (
    <section
      className="ui-public-band ui-public-section"
      id="solves"
      aria-labelledby="solves-title"
    >
      <div className="ui-public-container">
        <div className="text-center">
          <div className="ui-public-eyebrow">{PROBLEMS_SECTION.eyebrow}</div>
          <h2 id="solves-title" className="ui-public-display-lg mt-3 sm:mt-4">
            {PROBLEMS_SECTION.title}
          </h2>
          <p className="ui-public-section-lede mx-auto mt-4 sm:mt-6">{PROBLEMS_SECTION.lede}</p>
        </div>

        {PROBLEM_SCALES.map((scale) => (
          <div key={scale.id} className="ui-public-section-gap">
            <h3 className="ui-public-surface-card-title">{scale.title}</h3>
            <p className="ui-public-meta mt-1.5">{scale.subtitle}</p>
            <ul className="mt-5 grid gap-3 sm:mt-6 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
              {scale.items.map((item) => (
                <li key={item.id} className="flex min-w-0">
                  <Link href={item.link.href} className="ui-public-start-card w-full min-w-0">
                    <h4 className="ui-public-start-card-title">{item.problem}</h4>
                    <p className="ui-public-start-card-body">{item.solution}</p>
                    <span className="ui-public-start-card-link">{item.link.label} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="ui-public-section-gap text-center">
          <p className="ui-public-section-lede mx-auto">{PROBLEMS_SECTION.closer.text}</p>
          <div className="mt-6 sm:mt-8">
            <Link
              href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP}
              className="ui-public-cta w-full sm:w-auto"
            >
              {signedIn ? `Open ${APP_NAME}` : "Start a project"}
            </Link>
          </div>
          <p className="ui-public-meta mx-auto mt-4 max-w-md">{PROBLEMS_SECTION.closer.note}</p>
        </div>
      </div>
    </section>
  );
}
