"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/**
 * The one header every settings card wears: a title, one line under it, and
 * at most one action on the right. Cards of one surface share a frame, so a
 * reader learns the shape once (fleet AGENTS.md → "One shape per kind").
 */
export function SettingsSectionHeader({
  title,
  lede,
  action,
  id,
}: {
  title: string;
  lede?: ReactNode;
  /** One control, on the right: a refresh, a link to the fuller page. */
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="ui-settings-head">
      <div className="ui-settings-head-row">
        <h2 id={id} className="ui-settings-title">
          {title}
        </h2>
        {action}
      </div>
      {lede && <p className="ui-settings-lede">{lede}</p>}
    </div>
  );
}

/** The refresh a card with live numbers carries, drawn the same on each. */
export function SettingsRefresh({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-btn-ghost min-h-9 shrink-0 gap-1.5 px-2 text-xs"
      disabled={loading}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      Refresh
    </button>
  );
}
