import { ArrowUp, Check, Globe, Mic } from "lucide-react";
import { LokiMark } from "@/components/shell/LokiMark";

export type LoopFigureKind = "say" | "build" | "change";

/**
 * A small picture for each of the homepage's three steps: the box you say it
 * in, the work being done, the site with the Loki button on it.
 *
 * The page was 1,300 words and not one image. These are drawn, not captured:
 * shapes in the theme's own tokens, so they follow light and dark and cannot
 * go stale the way a screenshot does. They illustrate; they claim nothing.
 * The one sentence in them is the same example the box in the hero suggests,
 * and the address is the pattern step 02 already states. Decorative, so the
 * whole figure is hidden from assistive tech: the step's title and text say
 * what it shows.
 */
export function LoopFigure({ kind }: { kind: LoopFigureKind }) {
  return (
    <div className="ui-public-loop-frame" aria-hidden="true">
      {kind === "say" && (
        <div className="ui-public-loop-box">
          <p className="ui-public-loop-words">
            A website for my bakery, with opening hours and a map
          </p>
          <div className="ui-public-loop-box-row">
            <span className="ui-public-loop-dot">
              <Mic className="h-3.5 w-3.5" />
            </span>
            <span className="ui-public-loop-dot ui-public-loop-dot-on">
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      )}
      {kind === "build" && (
        <ul className="ui-public-loop-run">
          <li className="ui-public-loop-run-row">
            <Check className="ui-public-loop-run-mark" />
            <span>Project set up</span>
          </li>
          <li className="ui-public-loop-run-row">
            <Check className="ui-public-loop-run-mark" />
            <span>Pages built</span>
          </li>
          <li className="ui-public-loop-run-row ui-public-loop-run-row-now">
            <span className="ui-public-loop-run-pulse" />
            <span>Checking it on a phone</span>
          </li>
          <li className="ui-public-loop-run-row ui-public-loop-run-row-next">
            <span className="ui-public-loop-run-ring" />
            <span>Putting it online</span>
          </li>
        </ul>
      )}
      {kind === "change" && (
        <div className="ui-public-loop-site">
          <div className="ui-public-loop-address">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">yourname.orangecat.ch</span>
          </div>
          <div className="ui-public-loop-page">
            <span className="ui-public-loop-line w-2/5" />
            <span className="ui-public-loop-line w-4/5" />
            <span className="ui-public-loop-line w-3/5" />
          </div>
          <div className="ui-public-loop-ask">
            <span className="ui-public-loop-bubble">Make the opening hours bigger</span>
            <span className="ui-public-loop-button">
              <LokiMark turns="tiny" size={16} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
