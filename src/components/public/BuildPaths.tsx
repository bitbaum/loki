import Link from "next/link";
import { BUILD_PATHS } from "@/config/build-paths";

/**
 * The three doors, as rows — the landing page and /build render the same
 * list, so a path added to the config appears in both. The whole row is the
 * link.
 */
export function BuildPaths({ className = "" }: { className?: string }) {
  return (
    <ul className={`ui-public-rows ${className}`.trim()}>
      {BUILD_PATHS.map((path) => {
        const external = path.href.startsWith("http");
        return (
          <li key={path.id} className="flex">
            <Link
              href={path.href}
              className="ui-public-start-card w-full"
              {...(external ? { target: "_blank", rel: "noopener" } : {})}
            >
              <span className="ui-public-surface-card-label">{path.who}</span>
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
