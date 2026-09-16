"use client";

import { useSearchParams } from "next/navigation";
import { TerminalMobileShell } from "@/components/terminal/TerminalMobileShell";
import { TerminalSurface } from "@/components/terminal/TerminalSurface";
import type { TerminalSource } from "@/config/terminal-modes";
import { isValidUuid } from "@/lib/utils";

/** Legacy deep links used `source=server` for the cloud builder. Kept mapping
 *  so existing links (push notifications, FleetSurfaceGuide, bookmarks) still
 *  land on the right source after the rename to the mode SSOT. */
function parseSource(value: string | null): TerminalSource | undefined {
  if (value === "machine") return "machine";
  if (value === "cloud" || value === "server") return "cloud";
  if (value === "shell") return "shell";
  return undefined;
}

/** Client boundary for /terminal — owns mobile expand state and URL deep links. */
export function TerminalPageClient({ local }: { local: boolean }) {
  const searchParams = useSearchParams();
  const initialSource = parseSource(searchParams.get("source"));
  const initialTab = searchParams.get("project") ?? searchParams.get("tab");
  const runParam = searchParams.get("run");
  const initialRunId = runParam && isValidUuid(runParam) ? runParam : null;
  const surfaceKey = `${initialSource ?? "default"}:${initialTab ?? ""}:${initialRunId ?? ""}`;

  return (
    <TerminalMobileShell>
      {({ immersive, toggleImmersive }) => (
        <TerminalSurface
          key={surfaceKey}
          local={local}
          immersive={immersive}
          onToggleImmersive={toggleImmersive}
          initialSource={initialSource}
          initialTab={initialTab}
          initialRunId={initialRunId}
        />
      )}
    </TerminalMobileShell>
  );
}
