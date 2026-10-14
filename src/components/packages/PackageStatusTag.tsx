import { behindLabel, type PackageStatus } from "@/lib/packages/status";

/** One status, one colour: positive for latest, warning for behind, neutral for unknown. */
export function PackageStatusTag({ status }: { status: PackageStatus }) {
  // Behind is a warning, never an alarm: red is for something broken, and a
  // project a version behind is not. A breaking bump says so on hover.
  const tone =
    status.kind === "latest"
      ? "ui-tag-positive"
      : status.kind === "behind"
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
