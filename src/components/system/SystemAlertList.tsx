"use client";

import { useRouter } from "next/navigation";
import { AlertList, type AlertListItem } from "@/components/alerts/AlertList";

/** The alerts on /system; a dismissal re-reads the page, which lists from the DB. */
export function SystemAlertList({ alerts }: { alerts: AlertListItem[] }) {
  const router = useRouter();
  return <AlertList alerts={alerts} onDismissed={() => router.refresh()} />;
}
