"use client";

import { useEffect, useState } from "react";

/**
 * When a report was filed, in the READER's locale and time zone.
 *
 * This is a client component for one reason: `/my-feedback` is a server
 * component, and `Date#toLocaleString()` called there formats with the BOX's
 * ICU locale and the BOX's time zone. That is how a Swiss reporter came to be
 * shown "9/20/2026, 1:13:34 PM" — US month-first, and a wall-clock time two
 * hours off their own. The operator inbox never had the bug because its row is
 * already a client component; this page was the odd one out.
 *
 * First paint renders the ISO date only, because the server and the browser
 * must agree on the markup or React replaces it and logs a hydration error.
 * The exact instant lives in the `title` and the machine-readable value in
 * `dateTime`, so both survive whichever branch is showing.
 */
export function ReportedTime({ at }: { at: string }) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return;
    setLocal(d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [at]);

  return (
    <time dateTime={at} title={local ?? at} suppressHydrationWarning>
      {local ?? at.slice(0, 10)}
    </time>
  );
}
