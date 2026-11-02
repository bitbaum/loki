"use client";
/* eslint-disable @next/next/no-img-element -- Private, already-compressed browser evidence. */
import { useRef, useState } from "react";
import type { ReviewFrame, ReviewInput } from "@/lib/inspection/contract";

/**
 * The review's browser as the person sees it, and, once they take over, as
 * they drive it: a click on the picture is a click at that point of the page,
 * the wheel scrolls it, and the line below types into whatever has focus.
 * Under the picture one line always says what is happening now, what comes
 * next and how far along the review is, so nobody has to guess.
 */
export function ReviewBrowser({
  frame,
  live,
  driving,
  onInput,
}: {
  frame: ReviewFrame;
  /** The browser is running right now (a fresh heartbeat), not a saved view. */
  live: boolean;
  /** The person has the browser: the picture takes clicks, scrolls and typing. */
  driving: boolean;
  onInput: (input: ReviewInput) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Where the person clicked, kept only until a new picture shows what it did.
  const [mark, setMark] = useState<{ x: number; y: number; on: string } | null>(null);
  const [text, setText] = useState("");
  const scroll = useRef({ dy: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const path = new URL(frame.url).pathname;
  return (
    <div className="ui-inspection-browser" data-driving={driving || undefined}>
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-3">
        <div className="min-w-0 text-sm text-text-secondary">
          <span className="flex items-center gap-2">
            {(live || driving) && (
              <span
                className="ui-inspection-live"
                aria-label={driving ? "You have the browser" : "Live"}
              >
                {driving ? "You" : "Live"}
              </span>
            )}
            <a
              href={frame.url}
              target="_blank"
              rel="noreferrer"
              className="ui-link block break-all"
            >
              {path}
            </a>
          </span>
          <span className="mt-1 block text-text-primary">{frame.action}</span>
          {!driving && (frame.next || frame.progress) && (
            <span className="mt-1 block">
              {frame.next && <>Next: {frame.next}</>}
              {frame.next && frame.progress && " · "}
              {frame.progress && (
                <>
                  {frame.progress.done} of {frame.progress.total} pages done
                </>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          className="ui-btn-ghost min-h-11 shrink-0 text-sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Reduce view" : "Expand view"}
        </button>
      </div>
      <div
        className="ui-inspection-viewport"
        data-expanded={(expanded && !driving) || undefined}
        data-driving={driving || undefined}
        tabIndex={0}
        aria-label={
          driving ? "The browser: click to click on the page" : "Captured browser viewport"
        }
        onWheel={
          driving
            ? (e) => {
                // One scroll per pause in the wheel, not one per notch.
                scroll.current.dy += Math.round(e.deltaY);
                clearTimeout(scroll.current.timer);
                scroll.current.timer = setTimeout(() => {
                  const dy = Math.max(-3000, Math.min(3000, scroll.current.dy));
                  scroll.current.dy = 0;
                  if (dy) onInput({ type: "scroll", dy });
                }, 180);
              }
            : undefined
        }
      >
        <div className="relative">
          <img
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt={`Browser view of ${frame.url} at ${frame.width}px, scrolled ${Math.round(frame.scrollY)}px`}
            className={driving ? "ui-inspection-drive-picture" : "mx-auto block h-auto w-full"}
            onClick={
              driving
                ? (e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    const fx = (e.clientX - box.left) / box.width;
                    const fy = (e.clientY - box.top) / box.height;
                    setMark({ x: fx * 100, y: fy * 100, on: frame.image });
                    onInput({
                      type: "click",
                      x: Math.round(fx * frame.width),
                      y: Math.round(fy * frame.height),
                    });
                  }
                : undefined
            }
          />
          {mark?.on === frame.image && (
            <span
              className="ui-inspection-click"
              style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {driving && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text) return;
            onInput({ type: "type", text: text.slice(0, 200) });
            setText("");
          }}
        >
          <input
            className="ui-input min-h-11 w-full basis-full"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type into the page"
            aria-label="Type into the page"
            maxLength={200}
          />
          <button type="submit" className="ui-btn-secondary min-h-11" disabled={!text}>
            Type
          </button>
          <button
            type="button"
            className="ui-btn-ghost min-h-11"
            onClick={() => onInput({ type: "key", key: "Enter" })}
          >
            Enter
          </button>
          <button
            type="button"
            className="ui-btn-ghost min-h-11"
            onClick={() => onInput({ type: "back" })}
          >
            Back
          </button>
          <p className="mb-0 basis-full text-sm text-text-secondary">
            This browser only reads: links open, forms and buttons that would send or change
            something do nothing.
          </p>
        </form>
      )}
    </div>
  );
}
