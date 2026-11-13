import Link from "next/link";
import { BUILD_PATHS } from "@/config/build-paths";
import { visitorLink } from "@/lib/visitor-link";

/**
 * The three doors, as rows — the landing page and /build render the same
 * list, so a path added to the config appears in both. The whole row is the
 * link. No label above the title: "Do it yourself" over "Build it yourself"
 * said each card's one fact twice (2026-11-12).
 */
export function BuildPaths({
  className = "",
  signedIn = false,
}: {
  className?: string;
  /** Signed in, "Start a project" leads into Loki instead of to sign-up. */
  signedIn?: boolean;
}) {
  return (
    <ul className={`ui-public-rows ${className}`.trim()}>
      {BUILD_PATHS.map((entry) => {
        const { label: cta, href } = visitorLink({ label: entry.cta, href: entry.href }, signedIn);
        const path = { ...entry, cta, href };
        const external = path.href.startsWith("http");
        return (
          <li key={path.id} className="flex">
            <Link
              href={path.href}
              className="ui-public-start-card w-full"
              {...(external ? { target: "_blank", rel: "noopener" } : {})}
            >
              <span className="ui-public-start-card-title">{path.title}</span>
              <span className="ui-public-start-card-body">{path.body}</span>
              <span className="ui-public-start-card-link">{path.cta} →</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
