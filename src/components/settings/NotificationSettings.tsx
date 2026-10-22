"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { DIGEST_CADENCES, type DigestCadence } from "@/db/schema/notification-preferences";
import { COMMS_COPY, DIGEST_CADENCE_COPY } from "@/config/comms";

export function NotificationSettings() {
  const [cadence, setCadence] = useState<DigestCadence>("none");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<DigestCadence | null>(null);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notification-preferences")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCadence(d.emailDigestCadence ?? "none");
        setLastSentAt(d.lastDigestSentAt ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(next: DigestCadence) {
    if (next === cadence || saving) return;
    setSaving(next);
    setError(null);
    try {
      const res = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailDigestCadence: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setCadence(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="ui-settings-section">
      <SectionHeading title={COMMS_COPY.digestSettingsTitle} />
      <p className="-mt-1 text-sm text-text-secondary">{COMMS_COPY.digestSettingsBody}</p>

      <div className="-mx-3 mt-2 flex flex-col" role="radiogroup" aria-label="How often">
        {DIGEST_CADENCES.map((c) => {
          const active = cadence === c;
          const busy = saving === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(c)}
              disabled={!loaded || saving !== null}
              className="ui-settings-choice"
            >
              <span className="min-w-0 flex-1">
                <span className="ui-settings-choice-title">{DIGEST_CADENCE_COPY[c].label}</span>
                <span className="ui-settings-choice-note">
                  {DIGEST_CADENCE_COPY[c].description}
                </span>
              </span>
              {busy ? (
                <Loader2 className="ui-spinner-sm shrink-0" />
              ) : active ? (
                <Check className="h-5 w-5 shrink-0 text-text-primary" />
              ) : null}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-status-negative">{error}</p>}
      {lastSentAt && cadence !== "none" && (
        <p className="mt-3 text-sm text-text-tertiary">
          The last one went out {new Date(lastSentAt).toLocaleString()}.
        </p>
      )}
      {!lastSentAt && cadence !== "none" && (
        <p className="mt-3 text-sm text-text-tertiary">The first one arrives within a day.</p>
      )}
    </section>
  );
}
