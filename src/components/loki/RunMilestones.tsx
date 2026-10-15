import { dispatchToneDotClass } from "@/lib/dispatch-status";
import type { RunMilestone } from "@/lib/run-milestones";

const clock = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * What a running build has done so far, newest last, under its dispatch card
 * (lib/run-milestones.ts). Each row is a fact from the repository — the
 * builder's own words where it wrote some (a commit message, a PR title) and a
 * link to the thing itself.
 */
export function RunMilestones({ milestones }: { milestones: RunMilestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <ol className="ui-loki-milestones" aria-label="Progress so far">
      {milestones.map((m, i) => (
        <li key={`${m.key}-${i}`} className="ui-loki-milestone">
          <span className={`${dispatchToneDotClass(m.tone)} mt-2`} aria-hidden />
          <div className="min-w-0">
            <p className="ui-loki-milestone-label">
              {m.href ? (
                <a href={m.href} target="_blank" rel="noreferrer" className="hover:underline">
                  {m.label}
                </a>
              ) : (
                m.label
              )}
              <time className="ui-loki-milestone-time" dateTime={m.at}>
                {clock(m.at)}
              </time>
            </p>
            {m.quote && <p className="ui-loki-milestone-quote">“{m.quote}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
