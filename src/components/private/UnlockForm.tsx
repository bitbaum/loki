"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { postJson } from "@/lib/api/fetch";

type Area = { label: string; description: string; count?: number; unit?: string };

export function UnlockForm({ next, areas }: { next: string; areas: Area[] }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/pin", { pin });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setError(data.error ?? "Incorrect PIN");
      setPin("");
      inputRef.current?.focus();
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="ui-settings-section">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Enter your PIN</h2>
            <p className="mt-1 text-sm text-text-tertiary">
              The private zone stays unlocked for 30 minutes once you enter the right PIN.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={loading}
            className="ui-input ui-pin-input w-full text-center text-2xl"
            aria-label="Private zone PIN"
          />
          {error && <p className="ui-error">{error}</p>}
          <button
            type="submit"
            disabled={loading || pin.length === 0}
            className="ui-btn-primary w-full"
          >
            <Lock className="h-4 w-4" />
            {loading ? "Unlocking…" : "Unlock"}
          </button>
          {/* Say the consequence on the screen that depends on it. Both the
              change and the remove paths require the CURRENT PIN — deliberately,
              so a hijacked session cannot swap it — and no reset flow exists.
              Without this line the page implied a door that is not there. */}
          <p className="text-xs text-text-tertiary">
            Forgotten it? There is no automatic reset — the private zone stays locked until the PIN
            is entered.{" "}
            <Link
              href="/support"
              className="underline underline-offset-2 hover:text-text-secondary"
            >
              Get help
            </Link>
            .
          </p>
        </form>
      </div>

      <div className="ui-settings-section">
        <h3 className="text-sm font-semibold uppercase tracking-caps text-text-muted">
          What this unlocks
        </h3>
        <ul className="space-y-3">
          {areas.map((area) => (
            <li key={area.label} className="flex items-start gap-3">
              <span className="ui-public-prose-bullet mt-2" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-text-primary">{area.label}</span>
                  {typeof area.count === "number" && area.count > 0 && (
                    <span className="text-xs font-mono text-text-tertiary shrink-0">
                      {area.count.toLocaleString()} {area.unit ?? ""}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-text-tertiary">{area.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
