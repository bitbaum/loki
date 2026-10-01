import Link from "next/link";
import type { SupersededNotice as Notice } from "@/lib/thought-superseded";

/** Shown above an essay whose architecture has since been replaced. */
export function SupersededNotice({ notice }: { notice: Notice }) {
  return (
    <p className="ui-public-callout" role="note">
      This describes Loki as it was in {notice.asOf}. For how it works today, see{" "}
      <Link href={notice.href} className="ui-public-link">
        {notice.href}
      </Link>
      .
    </p>
  );
}
