"use client";

/**
 * A turn that failed says so where the answer would have been, with the way
 * out next to it — not as a detached line above the input. It rides in the
 * floating dock, just over the composer.
 */
export function TurnError({
  message,
  onRetry,
}: {
  message: string | null | undefined;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="ui-loki-error" role="alert">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" className="ui-loki-error-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
