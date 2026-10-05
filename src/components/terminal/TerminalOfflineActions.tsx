"use client";

import Link from "next/link";

/**
 * The way forward from an empty terminal whose builder is gated or offline.
 * The hint above it names what to do ("use this computer", "connect Fleet
 * Runner"), so the doing is a button on the same screen, not a sentence to
 * act on somewhere else.
 */
export function TerminalOfflineActions({ onUseThisComputer }: { onUseThisComputer?: () => void }) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-2">
      {onUseThisComputer && (
        <button type="button" className="ui-btn-secondary ui-btn-sm" onClick={onUseThisComputer}>
          Use this computer
        </button>
      )}
      <Link href="/download" className="ui-btn-ghost ui-btn-sm">
        Get Fleet Runner
      </Link>
    </div>
  );
}
