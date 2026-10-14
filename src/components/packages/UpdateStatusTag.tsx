import type { UpdateStatus } from "@/lib/packages/update-policy";

const TONE: Record<UpdateStatus["tone"], string> = {
  positive: "ui-tag-positive",
  warning: "ui-tag-warning",
  negative: "ui-tag-negative",
  neutral: "ui-tag-neutral",
};

/** Where an open update stands: waiting on tests, held for you, ready… */
export function UpdateStatusTag({ status }: { status: UpdateStatus }) {
  return <span className={`ui-tag ${TONE[status.tone]} shrink-0`}>{status.label}</span>;
}

/** Marks a step the project's code may have to change for. */
export function BreakingTag() {
  return (
    <span
      className="ui-tag ui-tag-warning shrink-0"
      title="A new major version, or a new minor under 1.0: the code may need changes to take it"
    >
      breaking
    </span>
  );
}
