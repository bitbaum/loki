import Link from "next/link";
import { APP_NAME } from "@/config/brand";
import { ROUTES } from "@/config/auth";
import { PROBLEMS_SECTION, PROBLEM_SCALES } from "@/config/problems-we-solve";

/**
 * Homepage "What it solves": one person's problems first, then the ones
 * communities share. Each row is problem → what happens in Loki → the page
 * where it happens, and the whole row is the tap target (an <a>). Copy and links are SSOT in
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
        <h2 id="solves-title" className="ui-public-h2">
          {PROBLEMS_SECTION.title}
        </h2>

        {PROBLEM_SCALES.map((scale) => (
          <div key={scale.id} className="ui-public-section-gap">
            <h3 className="ui-public-h3">{scale.title}</h3>
            <ul className="ui-public-rows mt-2">
              {scale.items.map((item) => (
                <li key={item.id} className="flex min-w-0">
                  <Link href={item.link.href} className="ui-public-start-card w-full min-w-0">
                    <span className="ui-public-start-card-title">{item.problem}</span>
                    <span className="ui-public-start-card-body">{item.solution}</span>
                    <span className="ui-public-start-card-link">{item.link.label} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* A link, not a second filled button: the page has one primary
            action, in the hero and again at the very end. */}
        <div className="ui-public-section-gap border-t border-border-subtle pt-6">
          <p className="ui-public-body-lg max-w-2xl">{PROBLEMS_SECTION.closer.text}</p>
          <p className="mt-3">
            <Link
              href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP}
              className="ui-public-text-link"
            >
              {signedIn ? `Open ${APP_NAME}` : "Start a project"} →
            </Link>
          </p>
          <p className="ui-public-meta mt-3 max-w-2xl">{PROBLEMS_SECTION.closer.note}</p>
        </div>
      </div>
    </section>
  );
}
