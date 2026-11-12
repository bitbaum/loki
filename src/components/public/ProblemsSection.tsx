import Link from "next/link";
import { PROBLEMS_SECTION, PROBLEM_SCALES } from "@/config/problems-we-solve";

/**
 * "What it solves": one person's problems first, then the ones communities
 * share. Each row is problem → what happens in Loki → the page where it
 * happens, and the whole row is the tap target (an <a>). Copy and links are
 * SSOT in config/problems-we-solve.ts.
 *
 * The homepage shows `featured` (the three ways in) and one link to the rest;
 * /why shows all of them. All twelve on the homepage were 4 of its 10.7 phone
 * screens and half its words, repeating the sections on either side.
 */
export function ProblemsSection({ featured }: { featured?: readonly string[] }) {
  const scales = featured
    ? [
        {
          id: "featured",
          title: null,
          items: PROBLEM_SCALES.flatMap((scale) => scale.items).filter((item) =>
            featured.includes(item.id),
          ),
        },
      ]
    : PROBLEM_SCALES;
  const total = PROBLEM_SCALES.reduce((n, scale) => n + scale.items.length, 0);

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

        {scales.map((scale) => (
          <div key={scale.id} className="ui-public-section-gap">
            {scale.title && <h3 className="ui-public-h3">{scale.title}</h3>}
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

        {featured ? (
          <p className="mt-6">
            <Link href={PROBLEMS_SECTION.all.href} className="ui-public-text-link">
              {PROBLEMS_SECTION.all.label.replace("{n}", String(total))} →
            </Link>
          </p>
        ) : (
          <p className="ui-public-body-lg ui-public-section-gap max-w-2xl border-t border-border-subtle pt-6">
            {PROBLEMS_SECTION.closer.text}
          </p>
        )}
      </div>
    </section>
  );
}
