"use client";

import { useState } from "react";
import { COMMS_COPY } from "@/config/comms";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { pushCardView } from "@/lib/push-card";
import { PhonePushView } from "./PhonePushView";

/** Settings → Notifications: turn this phone's notifications on, prove they work, turn them off. */
export function PhonePushCard() {
  const { status, error, publicKeyMissing, subscribe, unsubscribe } = usePushSubscription();
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const isIos = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const view = pushCardView({ status, keyMissing: publicKeyMissing, isIos, error });

  async function sendTest() {
    setTesting(true);
    setNote(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { sent?: number };
      const c = COMMS_COPY.phonePush;
      if (!res.ok) setNote(c.testFailed);
      else setNote((data.sent ?? 0) > 0 ? c.testSent(data.sent ?? 0) : c.testNone);
    } catch {
      setNote(COMMS_COPY.phonePush.testFailed);
    } finally {
      setTesting(false);
    }
  }

  return (
    <PhonePushView
      view={view}
      working={testing || status === "registering"}
      note={note}
      onAction={(action) => {
        if (action === "subscribe") void subscribe();
        else if (action === "unsubscribe") void unsubscribe();
        else void sendTest();
      }}
    />
  );
}
