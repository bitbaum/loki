"use client";
import { useEffect, useState } from "react";
import { ChevronsLeftRight, Sparkles } from "lucide-react";
import { INSTANT_PREVIEW_COPY as COPY } from "@/config/instant-preview";
import { useInstantPreview } from "@/hooks/use-instant-preview";

/**
 * "Show it on my site": the first minute on /change. The visitor's own page,
 * then the same page with what they asked for drawn on it, compared with a
 * slider — before any account, repository or build. The pictures come from
 * Loki's browser (api/site-consult/preview); the site itself is untouched.
 */
export type InstantLook = { before: string; after: string; summary: string | null };

export function InstantPreview({
  website,
  ask,
  onLook,
}: {
  website: string;
  ask: string;
  /** The before/after for exactly these words, or null — a build request
   *  carries it to the person who approves it (config/build-requests). */
  onLook?: (look: InstantLook | null) => void;
}) {
  const { state, run } = useInstantPreview();
  const key = `${website}\n${ask}`;
  const look =
    state.status === "done" && state.key === key && state.before && state.after
      ? { before: state.before, after: state.after, summary: state.summary }
      : null;
  const lookKey = look ? key : "";
  useEffect(() => {
    onLook?.(look);
    // `look` is rebuilt every render; what changes it is the result's key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, onLook]);
  const working = state.status === "working";
  const stale = state.status === "done" && state.key !== key;
  const ready = website.trim().length > 0 && ask.trim().length >= 3;

  return (
    <div className="ui-instant" aria-live="polite">
      {(state.status === "idle" || stale) && (
        <button
          type="button"
          className="ui-btn-secondary min-h-11"
          disabled={!ready}
          onClick={() => void run(website, ask)}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {stale ? COPY.again : COPY.button}
        </button>
      )}

      {working && (
        <div className="space-y-2" role="status">
          <p className="ui-instant-status">{state.now ? COPY.drawing : COPY.opening}</p>
          {state.now ? (
            <div className="ui-instant-frame ui-instant-drawing">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture from Loki's browser */}
              <img src={state.now} alt={`${website} as it is now, on a phone`} />
            </div>
          ) : (
            <div className="ui-instant-frame ui-instant-blank" aria-hidden />
          )}
        </div>
      )}

      {state.status === "done" && (
        <div className="space-y-2">
          {state.before && state.after ? (
            <BeforeAfter before={state.before} after={state.after} website={website} />
          ) : state.now ? (
            <div className="ui-instant-frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture from Loki's browser */}
              <img src={state.now} alt={`${website} as it is now, on a phone`} />
            </div>
          ) : null}
          {state.summary && <p className="ui-instant-summary">{state.summary}</p>}
          {state.message && <p className="ui-instant-status">{state.message}</p>}
          {state.before && <p className="ui-instant-note">{COPY.note}</p>}
        </div>
      )}
    </div>
  );
}

/** Two pictures of one spot, compared with a slider. Also on the visitor's
 *  request page and in the operator's queue, so all three see one thing. */
export function BeforeAfter({
  before,
  after,
  website,
}: {
  before: string;
  after: string;
  website: string;
}) {
  const [split, setSplit] = useState(50);
  return (
    <div className="ui-instant-frame ui-instant-compare">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture from Loki's browser */}
      <img src={after} alt={`${website} with the change, on a phone`} />
      <div className="ui-instant-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture from Loki's browser */}
        <img src={before} alt={`${website} as it is now, on a phone`} />
      </div>
      <span className="ui-instant-divider" style={{ left: `${split}%` }} aria-hidden>
        <span className="ui-instant-handle">
          <ChevronsLeftRight className="h-4 w-4" />
        </span>
      </span>
      <span className="ui-instant-label ui-instant-label-now">{COPY.nowLabel}</span>
      <span className="ui-instant-label ui-instant-label-after">{COPY.afterLabel}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        className="ui-instant-range"
        aria-label={COPY.slider}
      />
    </div>
  );
}
