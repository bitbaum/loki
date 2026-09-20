"use client";

import { useSyncExternalStore } from "react";

/**
 * When a report was filed, in the READER's locale and time zone.
 *
 * `/my-feedback` is a server component, so `Date#toLocaleString()` called
 * there formats with the BOX's ICU locale and the BOX's time zone. That is how
 * a Swiss reporter came to be shown "9/20/2026, 1:13:34 PM" — US month-first,
 * on a wall clock two hours off their own. The operator inbox never had the
 * bug: its row already renders client-side.
 *
 * Only the browser knows the reader's zone, so the localized string cannot
 * exist during SSR, and server and client must still emit the same markup or
 * React discards the tree. `useSyncExternalStore` with a server snapshot is
 * the shape this repo already uses for exactly that (BrandVersion,
 * NotificationsPill) — and it is how a client-only value is read WITHOUT
 * setState in an effect, which `react-hooks/set-state-in-effect` rejects.
 *
 * First paint is the ISO date alone: locale-neutral, so both sides agree.
 * `dateTime` always carries the exact instant for machines either way.
 */
const noopSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

function reportedLabel(at: string, mounted: boolean): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  if (!mounted) return at.slice(0, 10);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ReportedTime({ at }: { at: string }) {
  const mounted = useSyncExternalStore(noopSubscribe, onClient, onServer);
  const text = reportedLabel(at, mounted);
  return <time dateTime={at}>{text}</time>;
}
