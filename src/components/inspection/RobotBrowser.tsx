"use client";

import { useEffect, useRef, useState } from "react";
import { spotOf, viewOf, type RobotTarget, type Spot } from "@/lib/inspection/robot-view";
import { cn } from "@/lib/utils";

/* eslint-disable @next/next/no-img-element -- Loki's own browser evidence, already-encoded JPEG served by this app; it must not pass through a public image optimizer. */

export type RobotFrame = {
  url: string;
  image: string;
  width: number;
  height: number;
  action: string;
  target?: RobotTarget;
};

/**
 * Loki's browser, watched the way you would watch a friend use a page.
 *
 * Its pointer glides to what Loki is about to press and the press lights
 * up; the picture slides to keep it in sight and leans in when text would
 * be too small to read (lib/inspection/robot-view `viewOf`, one rule for
 * every size). It never leaves a void: a tall column is filled, a phone
 * page stands like a phone. At rest the pointer stays where it last was,
 * dimmed, and no ring is lit — a ring means a press happening now. Motion
 * stops for anyone who asked their device for less (globals.css).
 *
 * `fit="contain"`: a box of fixed height (the workbench) is filled.
 * `fit="width"`: as tall as the page is at this width (Review).
 */
export function RobotBrowser({
  frame,
  live,
  fit,
  onOpen,
  label,
}: {
  frame: RobotFrame;
  live: boolean;
  fit: "contain" | "width";
  /** A tap opens the real page. */
  onOpen?: () => void;
  label?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spot = spotOf(frame, frame.target);
  // The pointer stays where it last pressed while Loki only looks, so it
  // glides from there to the next press instead of appearing from nowhere.
  const [rest, setRest] = useState<Spot | null>(null);
  if (spot && (rest?.x !== spot.x || rest?.y !== spot.y)) setRest(spot);
  const pointer = spot ?? rest;
  const pressing = live && spot;

  const view = viewOf(
    frame,
    { width: box.width, height: fit === "contain" ? box.height : null },
    pressing ? spot : null,
  );
  const measured = box.width > 0;

  const picture = (
    <div
      ref={boxRef}
      className={cn("ui-robot-box", fit === "contain" ? "ui-robot-box-fill" : null)}
      style={
        fit === "width"
          ? measured
            ? { height: view.boxHeight }
            : { aspectRatio: `${frame.width} / ${frame.height}` }
          : undefined
      }
    >
      {measured && (
        <div
          className="ui-robot-layer"
          style={{
            width: view.layer.width,
            height: view.layer.height,
            transform: `translate(${view.layer.x}px, ${view.layer.y}px)`,
          }}
        >
          <img
            src={frame.image}
            width={frame.width}
            height={frame.height}
            alt={label ?? `Loki's browser on ${frame.url}: ${frame.action}`}
            draggable={false}
          />
          {pressing && (
            // Keyed by the picture: each new press draws its ring again.
            <span
              key={frame.image}
              className="ui-robot-ring"
              aria-hidden="true"
              style={{
                left: `${spot.left}%`,
                top: `${spot.top}%`,
                width: `${spot.width}%`,
                height: `${spot.height}%`,
              }}
            />
          )}
          {pointer && (
            <span
              className={cn("ui-robot-pointer", !pressing && "ui-robot-pointer-rest")}
              aria-hidden="true"
              style={{ left: `${pointer.x}%`, top: `${pointer.y}%` }}
            >
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M5 3l14 8-6.2 1.6L9.6 19z" />
              </svg>
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn("ui-robot", fit === "contain" && "ui-robot-fill")}
      data-live={live || undefined}
    >
      {onOpen ? (
        <button
          type="button"
          className={cn("ui-robot-open", fit === "contain" && "ui-robot-fill")}
          onClick={onOpen}
        >
          {picture}
        </button>
      ) : (
        picture
      )}
    </div>
  );
}
