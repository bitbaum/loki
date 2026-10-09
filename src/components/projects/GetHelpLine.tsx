import { BUILD_PATHS } from "@/config/build-paths";

/**
 * "Or get help" — the two doors that are not "do it yourself", at the moments
 * a build stalls on the owner. Same list as the landing page and /build
 * (config/build-paths.ts), so a partner directory or hire page that moves
 * moves here too. A brief, when there is one, travels to the studio the way
 * /change hands one over (`#brief=`), so the person is not asked to retype
 * what Loki already knows.
 */
export function GetHelpLine({
  brief,
  className = "",
}: {
  brief?: { website?: string | null; changes?: string | null } | null;
  className?: string;
}) {
  const doors = BUILD_PATHS.filter((p) => p.id !== "yourself");
  const hash =
    brief && (brief.website || brief.changes)
      ? `#brief=${encodeURIComponent(JSON.stringify({ website: brief.website ?? "", changes: brief.changes ?? "" }))}`
      : "";
  return (
    <p className={`text-xs leading-relaxed text-text-tertiary ${className}`.trim()}>
      Or get help:{" "}
      {doors.map((d, i) => (
        <span key={d.id}>
          {i > 0 && " · "}
          <a
            href={d.id === "studio" ? `${d.href}${hash}` : d.href}
            target="_blank"
            rel="noopener"
            className="ui-link-subtle"
          >
            {d.cta}
          </a>
        </span>
      ))}
    </p>
  );
}
