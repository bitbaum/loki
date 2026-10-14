"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import {
  BREAKING_ALWAYS_ASKS,
  PACKAGE_UPDATE_SETTINGS,
  type PackageUpdateSetting,
} from "@/config/package-updates";

/**
 * How shared-package updates reach this project — three choices, each with
 * what it will do written under it, changeable in one press. The new choice
 * reaches the open pull requests straight away when GitHub answers in time;
 * otherwise the answer says when it will.
 */
export function PackageUpdateSettingControl({
  projectId,
  initial,
}: {
  projectId: string;
  initial: PackageUpdateSetting;
}) {
  const router = useRouter();
  const [setting, setSetting] = useState(initial);
  const [busy, setBusy] = useState<PackageUpdateSetting | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function choose(next: PackageUpdateSetting) {
    if (next === setting || busy) return;
    const before = setting;
    setSetting(next);
    setBusy(next);
    setMessage(null);
    try {
      const res = await patchJson(`/api/projects/${projectId}/package-updates`, {
        setting: next,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save the choice.");
      setMessage({ text: body.message ?? "Saved.", error: false });
      router.refresh();
    } catch (err) {
      setSetting(before);
      setMessage({
        text: err instanceof Error ? err.message : "Could not save the choice.",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }

  const current = PACKAGE_UPDATE_SETTINGS.find((s) => s.id === setting);
  return (
    <div className="space-y-2">
      <p id="package-updates-label" className="ui-micro-label">
        When a package has an update
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-labelledby="package-updates-label"
      >
        {PACKAGE_UPDATE_SETTINGS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={setting === s.id}
            disabled={busy !== null}
            onClick={() => void choose(s.id)}
            className={`${setting === s.id ? "ui-chip-toggle-active" : "ui-chip-toggle"} gap-1.5`}
          >
            {busy === s.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-text-secondary">{current?.consequence}</p>
      <p className="text-xs text-text-tertiary">{BREAKING_ALWAYS_ASKS}</p>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "ui-error-xs" : "text-xs text-text-tertiary"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
