import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PushCardView } from "@/lib/push-card";

/**
 * The card, with no state of its own: it draws a PushCardView. Kept apart from
 * the container so every state can be rendered and LOOKED AT without a browser
 * that supports push (scripts/preview/build-push-preview.mjs does exactly that).
 */
export function PhonePushView({
  view,
  working,
  note,
  onAction,
}: {
  view: PushCardView;
  /** An action is in flight (subscribing, sending the test). */
  working: boolean;
  /** The last thing that happened, in a sentence. */
  note: string | null;
  onAction: (action: "subscribe" | "test" | "unsubscribe") => void;
}) {
  const Icon = view.tone === "on" ? BellRing : view.tone === "off" ? Bell : BellOff;
  return (
    <section className="ui-settings-section">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            view.tone === "on" ? "text-status-positive" : "text-text-secondary",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-text-primary">{view.headline}</h2>
          <p className="text-sm text-text-secondary">{view.body}</p>
        </div>
      </div>

      {(view.primary || view.secondary) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {view.primary && (
            <button
              type="button"
              className="ui-btn-primary min-h-11 gap-1.5"
              disabled={working}
              onClick={() => onAction(view.primary!.action)}
            >
              {working && <Loader2 className="ui-spinner-xs" />}
              {view.primary.label}
            </button>
          )}
          {view.secondary && (
            <button
              type="button"
              className="ui-btn-secondary min-h-11"
              disabled={working}
              onClick={() => onAction(view.secondary!.action)}
            >
              {view.secondary.label}
            </button>
          )}
        </div>
      )}

      {note && (
        <p className="mt-3 text-sm text-text-secondary" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
