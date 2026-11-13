import { behindLabel, type PackageStatus } from "@/lib/packages/status";

/** One status, one colour: positive for latest, warning for a breaking bump, else neutral. */
export function PackageStatusTag({
  status,
  calm = false,
}: {
  status: PackageStatus;
  /** Behind, but nothing for the person to do: updates arrive by themselves
   *  (or they chose to stay). A warning there is colour spent on a fact. */
  calm?: boolean;
}) {
  // Behind is not a problem: an update nobody has taken yet. Twenty amber
  // "behind" pills made the warning hue the page's accent (2026-11-12). Only
  // a breaking bump, which may need code changes, is worth the warning.
  const tone =
    status.kind === "latest"
      ? "ui-tag-positive"
      : status.kind === "behind" && status.breaking && !calm
        ? "ui-tag-warning"
        : "ui-tag-neutral";
  return (
    <span
      className={`ui-tag ${tone} shrink-0`}
      title={
        status.kind === "behind" && status.breaking
          ? "A breaking bump: the code may need changes to take it"
          : undefined
      }
    >
      {behindLabel(status)}
    </span>
  );
}
