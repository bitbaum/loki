"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postJson, deleteJson } from "@/lib/api/fetch";
import { PIN_MAX_DIGITS } from "@/lib/constants/auth";

type PinStatus = {
  configured: boolean;
  unlocked: boolean;
};

export function PrivatePinGate({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/pin")
      .then((r) => r.json())
      .then((d: PinStatus) => setStatus(d))
      .catch(() => setStatus({ configured: true, unlocked: false }));
  }, []);

  useEffect(() => {
    if (status && !status.unlocked) {
      inputRef.current?.focus();
    }
  }, [status]);

  if (!status) return null;

  if (!status.configured || status.unlocked) {
    return <>{children}</>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError("");
    try {
      const res = await postJson("/api/auth/pin", { pin });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus({ configured: true, unlocked: true });
        router.refresh();
      } else {
        setError(data.error ?? "Incorrect PIN");
        setPin("");
        inputRef.current?.focus();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-page flex items-center justify-center">
      <div className="ui-panel w-full max-w-sm p-8">
        <p className="ui-kicker mb-4">Private Zone</p>
        <h1 className="ui-page-title mb-2">Enter PIN</h1>
        <p className="text-text-secondary mb-6 text-sm">
          This section is PIN-protected. Your unlock lasts 30 minutes.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="ui-input text-center text-xl tracking-widest"
            disabled={loading}
            autoComplete="one-time-code"
            maxLength={PIN_MAX_DIGITS}
          />
          {error && <p className="ui-error text-center">{error}</p>}
          <button type="submit" className="ui-btn-primary" disabled={loading || !pin}>
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>
        {/* A gate records; it never blocks — and this one blocked absolutely.
            Changing or removing the PIN both require the CURRENT one (on
            purpose: it stops a hijacked session swapping it), and there is no
            reset flow anywhere. So a forgotten PIN meant a screen with an
            input, "Incorrect PIN", and nothing else — while the zone behind it
            holds thousands of contacts and the whole knowledge graph. The way
            out is not to weaken the gate, it is to stop pretending there is a
            way in. */}
        <p className="mt-6 text-xs text-text-tertiary">
          Forgotten it? There is no automatic reset — the private zone stays locked until the PIN is
          entered.{" "}
          <Link href="/support" className="underline underline-offset-2 hover:text-text-secondary">
            Get help
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/** Call from sidebar lock button — clears httpOnly cookie and refreshes RSC tree. */
export async function lockPrivateZone(router: { refresh: () => void }) {
  await deleteJson("/api/auth/pin");
  router.refresh();
}
