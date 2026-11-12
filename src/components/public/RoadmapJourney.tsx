import { Fragment, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { APP_DOMAIN } from "@/config/brand";
import type { Journey, JourneyStop } from "@/lib/register/roadmap-journey";
import { recordText, type RecordLinks } from "@/lib/register/record-links";

/**
 * The roadmap drawn as a road: what is behind us, a "you are here" for what is
 * being built now, the stops ahead, and the horizon.
 *
 * It replaced four stacked lists of equal weight, which made a reader do the
 * one thing a roadmap exists to spare them — work out where things stand.
 * Here the answer is the first thing on screen (how much of the road is
 * shipped), and every stop shows its own progress as a ring filled from
 * ticked steps only. A stop with no steps shows no number rather than an
 * invented one.
 *
 * Server-rendered, no client JavaScript: steps open with <details>, and the
 * only motion (the beacon at "you are here", rings drawing in) is CSS that
 * stops under prefers-reduced-motion.
 */
export function RoadmapJourney({ journey, links }: { journey: Journey; links?: RecordLinks }) {
  const road = journey.now.length + journey.next.length + journey.later.length;
  const total = journey.shipped.length + road;
  return (
    <div className="ui-journey">
      <JourneyHeadline journey={journey} total={total} />

      <ol className="ui-journey-track">
        {journey.shipped.length > 0 && (
          <li id="shipped" className="ui-journey-stop" data-phase="shipped">
            <span className="ui-journey-marker" aria-hidden>
              <Check className="h-5 w-5" />
            </span>
            <details className="ui-journey-card ui-journey-card-quiet">
              <summary className="ui-journey-summary">
                <span className="ui-journey-kicker">Behind us</span>
                <span className="ui-journey-title">
                  {journey.shipped.length} shipped {journey.shipped.length === 1 ? "item" : "items"}
                </span>
                <span className="ui-journey-hint">Show them</span>
              </summary>
              <ul className="ui-journey-shipped-list">
                {journey.shipped.map((s) => (
                  <li key={s.title}>
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0">{s.title}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        )}

        {journey.now.map((stop, i) => (
          <Stop
            key={stop.title}
            stop={stop}
            links={links}
            here={i === 0}
            anchor={i === 0 ? "now" : undefined}
          />
        ))}
        {journey.next.map((stop, i) => (
          <Stop key={stop.title} stop={stop} links={links} anchor={i === 0 ? "next" : undefined} />
        ))}

        {journey.later.length > 0 && (
          <li id="later" className="ui-journey-stop" data-phase="later">
            <span className="ui-journey-marker" aria-hidden />
            <div className="ui-journey-card ui-journey-card-quiet">
              <span className="ui-journey-kicker">On the horizon</span>
              <ul className="ui-journey-horizon">
                {journey.later.map((s) => (
                  <li key={s.title}>
                    <span className="ui-journey-prose-strong">{recordText(s.title)}</span>
                    {s.line && <span className="ui-journey-line"> — {withLinks(s.line)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

/**
 * A bare address in a roadmap line, as a link. "Essay: https://…" printed as
 * plain text that broke mid-word and could not be tapped (2026-11-12). An
 * address on this site links by its path, which is all a reader needs to see.
 */
export function withLinks(text: string): ReactNode {
  return text.split(/(https?:\/\/[^\s)]+[^\s).,;:])/).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return <Fragment key={i}>{part}</Fragment>;
    const url = new URL(part);
    const own = url.hostname === APP_DOMAIN;
    const href = own ? `${url.pathname}${url.search}${url.hash}` : part;
    return (
      <a key={i} href={href} className="ui-public-link">
        {own ? href : `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`}
      </a>
    );
  });
}

/**
 * How far along, before anything else: one count and one bar. It used to lead
 * with "47% of the road is shipped" (items) beside "22 of 59 steps done"
 * (37%, steps) and rings reading a bare "67", "25": three measures that
 * disagreed on one screen (2026-11-12). The headline counts items; the steps
 * line says it is the work inside the open ones; a ring is a picture, and its
 * card's "6/9 steps" is the number.
 */
function JourneyHeadline({ journey, total }: { journey: Journey; total: number }) {
  const segments: { phase: string; count: number; label: string; href: string }[] = [
    { phase: "shipped", count: journey.shipped.length, label: "shipped", href: "#shipped" },
    { phase: "now", count: journey.now.length, label: "being built", href: "#now" },
    { phase: "next", count: journey.next.length, label: "next", href: "#next" },
    { phase: "later", count: journey.later.length, label: "later", href: "#later" },
  ];
  return (
    <div className="ui-journey-headline">
      <div className="flex items-baseline gap-3">
        <span className="ui-journey-percent">{journey.shipped.length}</span>
        <span className="ui-journey-percent-label">of {total} items shipped</span>
      </div>
      <div className="ui-journey-bar" role="img" aria-label={barLabel(segments, total)}>
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span
              key={s.phase}
              className="ui-journey-bar-seg"
              data-phase={s.phase}
              style={{ flexGrow: s.count }}
            />
          ))}
      </div>
      <nav className="ui-journey-legend" aria-label="Roadmap sections">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <a key={s.phase} href={s.href} className="ui-journey-legend-item" data-phase={s.phase}>
              <span className="ui-journey-legend-dot" aria-hidden />
              {s.count} {s.label}
            </a>
          ))}
      </nav>
      {journey.stepsTotal > 0 && (
        <p className="ui-journey-steps-total">
          Inside the {total - journey.shipped.length} items still open: {journey.stepsDone} of{" "}
          {journey.stepsTotal} steps done
        </p>
      )}
    </div>
  );
}

function barLabel(segments: { count: number; label: string }[], total: number): string {
  return `${total} items: ${segments
    .filter((s) => s.count > 0)
    .map((s) => `${s.count} ${s.label}`)
    .join(", ")}`;
}

/** One stop ahead: a progress ring on the road, the card beside it. */
function Stop({
  stop,
  here = false,
  anchor,
  links,
}: {
  stop: JourneyStop;
  here?: boolean;
  anchor?: string;
  /** Changelog days per milestone (`{#id}` in both records); absent = none shown. */
  links?: RecordLinks | undefined;
}) {
  return (
    <li
      id={anchor}
      className="ui-journey-stop"
      data-phase={stop.phase}
      data-here={here || undefined}
    >
      <span className="ui-journey-marker" aria-hidden>
        <Ring percent={stop.percent} />
      </span>
      <div className="ui-journey-card">
        {here && <span className="ui-journey-here">You are here</span>}
        {!here && stop.phase === "now" && (
          <span className="ui-journey-kicker">Also being built</span>
        )}
        <h3 className="ui-journey-title">{recordText(stop.title)}</h3>
        {stop.line && <p className="ui-journey-line">{withLinks(stop.line)}</p>}
        {stop.nextStep && (
          <p className="ui-journey-next">
            <span className="ui-journey-next-label">Next step</span> {recordText(stop.nextStep)}
          </p>
        )}
        {stop.total > 0 && (
          <details className="ui-journey-steps">
            <summary className="ui-journey-summary-inline">
              {stop.done}/{stop.total} steps
              {stop.targetDate ? ` · target ${stop.targetDate}` : ""}
              <ChevronDown className="ui-disclosure-chevron" aria-hidden />
            </summary>
            <ul className="ui-journey-step-list">
              {stop.milestones.map((m) => {
                const cites = links?.deliveredIn(m.title) ?? [];
                return (
                  <li
                    key={m.title}
                    id={links?.stepAnchor(m.title) ?? undefined}
                    data-done={m.done || undefined}
                  >
                    <span className="ui-journey-step-mark" aria-hidden>
                      {m.done ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      {recordText(m.title)}
                      <span className="sr-only">{m.done ? " — done" : " — not done"}</span>
                      {cites.length > 0 && (
                        <span className="ui-journey-cites">
                          {m.done ? "Shipped" : "Worked on"}
                          {cites.map((c) => (
                            <a key={c.anchor} href={`/changelog#${c.anchor}`} title={c.line}>
                              {c.date}
                            </a>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {stop.total === 0 && stop.targetDate && (
          <p className="ui-journey-hint">target {stop.targetDate}</p>
        )}
      </div>
    </li>
  );
}

const R = 17;
const C = 2 * Math.PI * R;

/** Progress as a ring that fills; no number when there are no steps to count. */
function Ring({ percent }: { percent: number | null }) {
  const filled = percent === null ? 0 : (percent / 100) * C;
  return (
    <svg viewBox="0 0 40 40" className="ui-journey-ring">
      <circle cx="20" cy="20" r={R} className="ui-journey-ring-track" />
      {percent !== null && percent > 0 && (
        <circle
          cx="20"
          cy="20"
          r={R}
          className="ui-journey-ring-fill"
          strokeDasharray={`${filled} ${C}`}
          transform="rotate(-90 20 20)"
        />
      )}
    </svg>
  );
}
