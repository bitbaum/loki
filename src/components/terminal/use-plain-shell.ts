"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { postJson } from "@/lib/api/fetch";
import type { BuilderChannel } from "@/lib/event-stream-types";

export type ShellStatus = {
  /** False for every account but the operator's — the entry is not drawn. */
  allowed: boolean;
  pinConfigured: boolean;
  unlocked: boolean;
  idleMinutes: number;
  online: boolean;
  open: number;
  max: number;
};

/** How long a queued shell may take to show up before it is called missing. */
const OPEN_WAIT_MS = 30_000;

export type PlainShellControl = ReturnType<typeof usePlainShell>;

/**
 * Everything the screen needs to offer, unlock, open and re-lock a plain shell
 * on one builder. The server decides every one of these answers
 * (/api/shell/status); this only asks, and re-asks when a shell says it locked.
 */
export function usePlainShell(
  channel: BuilderChannel,
  tabs: readonly string[],
  onOpened: (tab: string) => void,
) {
  const { data, refetch } = useFetch<ShellStatus>(`/api/shell/status?channel=${channel}`, {
    intervalMs: 20_000,
  });
  // A stable "ask the server again", for transports that outlive a render.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const recheck = useCallback(() => refetchRef.current(), []);
  const [pinOpen, setPinOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await postJson("/api/shell/open", { channel });
      const body = (await res.json().catch(() => ({}))) as { tab?: string; error?: string };
      if (!res.ok || !body.tab) {
        setError(body.error ?? "The shell did not open. Try again.");
        refetch();
        return;
      }
      setPending(body.tab);
    } catch {
      setError("The shell did not open. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }, [channel, refetch]);

  // The queued shell appears in the builder's tab list within a few seconds;
  // select it the moment it does.
  useEffect(() => {
    if (pending && tabs.includes(pending)) {
      onOpened(pending);
      setPending(null); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [pending, tabs, onOpened]);

  // …and if it never does (an older builder that does not know the command, or
  // one that is switched off), say so instead of spinning.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setPending(null);
      setError(
        "The runner did not open a shell. It may be updating or have shells switched off — try again in a minute.",
      );
    }, OPEN_WAIT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const start = useCallback(() => {
    setError(null);
    if (data && !data.unlocked) setPinOpen(true);
    else void open();
  }, [data, open]);

  const unlock = useCallback(
    async (pin: string): Promise<string | null> => {
      try {
        const res = await postJson("/api/shell/unlock", { pin });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) return body.error ?? "That did not work. Try again.";
      } catch {
        return "Network error — try again.";
      }
      refetch();
      // Unlocking from the "open" sheet carries on to opening; unlocking a
      // locked screen simply shows it again.
      if (pinOpen) {
        setPinOpen(false);
        void open();
      }
      return null;
    },
    [open, pinOpen, refetch],
  );

  const lock = useCallback(async () => {
    await fetch("/api/shell/unlock", { method: "DELETE" }).catch(() => {});
    refetch();
  }, [refetch]);

  return {
    channel,
    status: data,
    busy: starting || pending !== null,
    error,
    pinOpen,
    closePin: () => setPinOpen(false),
    start,
    unlock,
    lock,
    refetch,
    recheck,
  };
}
