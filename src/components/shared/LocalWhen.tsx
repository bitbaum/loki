"use client";

import { useSyncExternalStore } from "react";
import { APP_LOCALE } from "@/lib/constants";

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * A moment in the READER's time zone: "Fri 23 Oct, 06:02". The approvals
 * queue printed a proposed event's start as "2026-10-23T04:02:58.510Z" —
 * the raw stored value, in UTC. The server does not know the reader's clock,
 * so the first render shows the bare date and the time arrives after mount
 * (the same reason Greeting does it).
 */
export function LocalWhen({ value }: { value: string }) {
  const mounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <>{value}</>;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!mounted || dateOnly) {
    return (
      <>
        {d.toLocaleDateString(APP_LOCALE, {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}
      </>
    );
  }
  return (
    <>
      {d.toLocaleString(APP_LOCALE, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </>
  );
}
