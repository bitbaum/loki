import { Check, CornerDownRight, ExternalLink, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectTitle } from "@/lib/project-display";
import {
  askForMissing,
  askToFinish,
  OWED_WORDS,
  UPDATE_STAGE,
  isNone,
  UPDATE_SECTIONS,
  UPDATE_STAGE_LABEL,
  type ProgressUpdate,
} from "@/lib/loki/progress-update";

/**
 * A progress update in the thread — what Loki's builders tell the person they
 * work for when work moves (lib/loki/progress-update.ts). The order is fixed
 * and every section is optional, so a thin update stays short and a rich one
 * reads top to bottom: where it stands, what was asked, what was wrong, what
 * was done and why, what else was weighed, what could come next, the
 * evidence, then the one thing to do about it.
 */
const TONE_TAG = {
  positive: "ui-tag-positive",
  accent: "ui-tag-accent",
  warning: "ui-tag-warning",
  negative: "ui-tag-negative",
} as const;

export function ProgressUpdateCard({
  update,
  onContinue,
}: {
  update: ProgressUpdate;
  /** Send a follow-up in this chat, on this update's project. */
  onContinue?: (text: string, project: string) => void;
}) {
  const stage = UPDATE_STAGE_LABEL[update.stage];
  const name = projectTitle({ name: update.project });
  const finish = update.stage === UPDATE_STAGE.NOT_DONE ? askToFinish(update) : null;
  return (
    <article className="ui-loki-update" aria-label={`${name}: ${stage.label}`}>
      <header className="ui-loki-update-head">
        <span className={cn("ui-tag", TONE_TAG[stage.tone])}>{stage.label}</span>
        {update.behindTheScenes && <span className="ui-tag">Behind the scenes</span>}
        <span className="ui-loki-update-project">{name}</span>
      </header>
      <p className="ui-loki-update-headline">{update.headline}</p>

      <div className="ui-loki-update-sections">
        {UPDATE_SECTIONS.map((s) => {
          // Alternatives sit between "why this way" and "next": they are
          // the rest of the argument for the choice, and the ground the
          // next step would cover.
          const alternatives =
            s.key === "next" && update.considered.length > 0 ? (
              <section key="considered">
                <h4 className="ui-loki-update-label">Also considered</h4>
                <ul className="ui-loki-update-alt">
                  {update.considered.map((c) => (
                    <li key={c.option}>
                      <span className="ui-loki-update-alt-option">{c.option}</span>
                      {c.whyNot ? ` — ${c.whyNot}` : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          const value = update[s.key];
          // What was left unsaid is one line after the sections, not
          // "Not stated … worth asking" four times over.
          return [
            alternatives,
            value && isNone(value) ? (
              // Said out loud: "no downsides" is a finding, and a blank would
              // read the same as "nobody looked".
              <section key={s.key}>
                <h4 className="ui-loki-update-label">{s.label}</h4>
                <p className="ui-loki-update-none">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  None
                </p>
              </section>
            ) : value ? (
              <section key={s.key}>
                <h4 className="ui-loki-update-label">{s.label}</h4>
                <p className={s.key === "asked" ? "ui-loki-update-asked" : "ui-loki-update-text"}>
                  {s.key === "asked" ? `“${value}”` : value}
                </p>
              </section>
            ) : null,
          ];
        })}
      </div>

      {update.missing.length > 0 && (
        <div className="ui-loki-update-gap">
          <p className="ui-loki-update-missing">
            Not stated: {update.missing.map((k) => OWED_WORDS[k]).join(", ")}
          </p>
          {onContinue && (
            <button
              type="button"
              className="ui-btn-secondary inline-flex items-center gap-1.5"
              onClick={() => onContinue(askForMissing(update), update.project)}
            >
              <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Ask
            </button>
          )}
        </div>
      )}

      {update.images.length > 0 && (
        <div className="ui-loki-update-shots">
          {update.images.map((img) => (
            <a
              key={img.src}
              href={img.src}
              target="_blank"
              rel="noreferrer"
              className="ui-loki-update-shot"
            >
              {/* An owner-only API image, not a static asset — next/image
                  would proxy it through the optimizer without the session. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.caption} loading="lazy" />
              <span className="ui-loki-update-shot-caption">{img.caption}</span>
            </a>
          ))}
        </div>
      )}

      {(update.links.length > 0 || (finish && onContinue)) && (
        <div className="ui-loki-update-actions">
          {finish && onContinue && (
            <button
              type="button"
              className="ui-btn-save inline-flex items-center gap-1.5"
              onClick={() => onContinue(finish, update.project)}
            >
              Ask it to finish
            </button>
          )}
          {update.links.map((l) => {
            const external = /^https?:\/\//.test(l.href);
            const watch = l.href.endsWith("/watch-fix");
            return (
              <a
                key={l.href}
                href={l.href}
                {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                className={cn(
                  "inline-flex items-center gap-1.5",
                  l.primary ? "ui-btn-save" : "ui-btn-secondary",
                )}
              >
                {watch && <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                {l.label}
                {external && !watch && (
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
              </a>
            );
          })}
        </div>
      )}
    </article>
  );
}
