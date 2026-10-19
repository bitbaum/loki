"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
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
      <p className="ui-micro-label" aria-hidden="true">
        When a package has an update
      </p>
      <Segmented
        label="When a package has an update"
        options={PACKAGE_UPDATE_SETTINGS.map((s) => ({ id: s.id, label: s.label }))}
        value={setting}
        pending={busy}
        onChange={(id) => {
          if (busy === null) void choose(id as typeof setting);
        }}
      />
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
