import Link from "next/link";
import { BUILD_PATHS } from "@/config/build-paths";

/**
 * The three doors, as cards — the landing page and /build render the same
 * list, so a path added to the config appears in both.
 */
export function BuildPaths({ className = "" }: { className?: string }) {
  return (
    <div className={`grid gap-3 sm:gap-4 md:grid-cols-3 ${className}`.trim()}>
      {BUILD_PATHS.map((path) => {
        const external = path.href.startsWith("http");
        return (
          <Link
            key={path.id}
            href={path.href}
            className="ui-public-start-card"
            {...(external ? { target: "_blank", rel: "noopener" } : {})}
          >
            <div className="ui-public-surface-card-label">{path.who}</div>
            <h3 className="ui-public-start-card-title mt-2">{path.title}</h3>
            <p className="ui-public-start-card-body">{path.body}</p>
            <span className="ui-public-start-card-link">{path.cta} →</span>
          </Link>
        );
      })}
    </div>
  );
}
