"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Gauge, KeyRound, Lock, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getJson } from "@/lib/api/fetch";
import type { BudgetView } from "@/lib/ai/budget-view";
import { describeChatModel, type LokiModelsResponse } from "@/lib/loki/models";
import { MODEL_STORE_PATH, OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

/**
 * Which model starts the turn.
 *
 * ── Why "starting point" and not "model" ─────────────────────────────────────
 * Loki runs on a CHAIN, not a model: it walks across vendors when one rots,
 * rate-limits, or runs out of its daily free budget. A picker that pinned one
 * model would hand the operator back the single point of failure the chain
 * exists to remove — on the free tier, a pin is a scheduled outage. So a choice
 * here says where the chain STARTS and the fallback below it survives, which is
 * exactly what `chainFrom()` already means. The footnote in the menu says so,
 * because a control that silently does something other than its label is worse
 * than no control.
 *
 * ── Locked rows ──────────────────────────────────────────────────────────────
 * A vendor with no key on the server is listed, disabled, with the reason.
 * Hiding it answers "why can't I pick X" with silence; enabling it answers with
 * a failed turn. The way out is in the same menu: the last row is the link to
 * add your own key, and a model you brought sits at the top marked as yours —
 * so the picker is never a list of things you cannot have.
 *
 * ── What is left, before the pick ────────────────────────────────────────────
 * The line above the rows is the person's budget (`/api/ai/budget`): how many
 * free answers are left now, or that their keys answer first with no cap. A
 * free row whose vendor is spent or low says so on the row. Until this, the
 * first a person heard of the daily share was the refusal — a picker that
 * offers a row it will then refuse is the locked-row mistake in a new coat.
 */
export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  /** undefined = Auto (walk the whole chain). */
  value: string | undefined;
  onChange: (model: string | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LokiModelsResponse | null>(null);
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery("(max-width: 767px)");

  // Fetched on first open, not on mount: most turns never touch this control,
  // and the composer should not cost a request to render.
  useEffect(() => {
    if (!open || data) return;
    let live = true;
    getJson<LokiModelsResponse>("/api/loki/models")
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live)
          setData({
            options: [],
            autoStartsAt: null,
            autoSummary: null,
            addKeyHref: MODEL_STORE_PATH,
          });
      });
    // Alongside, never instead: the rows must render whether or not the
    // budget can be read, and a budget that cannot be read is simply absent —
    // "could not look" must never draw as "nothing left".
    getJson<BudgetView>("/api/ai/budget")
      .then((b) => {
        if (live) setBudget(b);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (model: string | undefined) => {
    onChange(model);
    setOpen(false);
  };

  const current = value ? describeChatModel(value).name : "Auto";

  // What a vendor last said about a free row, keyed as the rows are.
  const headroom = new Map((budget?.models ?? []).map((m) => [m.id, m.note]));
  // What the person's own key spent today, matched by the label the row shows.
  const ownSpend = (label: string, model: string) =>
    budget?.ownKeys.find((k) => k.label === label && k.model === model) ?? null;

  // One list, two containers: a popover above the composer on a laptop, a
  // bottom sheet on a phone (where a popover is a cramped box under a thumb).
  const list = (
    <>
      <div className="ui-loki-model-card" role="listbox" aria-label="Model">
        {budget && (
          <a href={OWN_MODEL_SETTINGS_PATH} className="ui-loki-model-budget">
            <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
            <span>{budget.headline}</span>
          </a>
        )}
        <ModelRow
          name="Auto"
          blurb={
            data?.autoSummary
              ? data.autoSummary.replace(/^Auto · /, "")
              : data?.autoStartsAt
                ? `Best available right now — ${describeChatModel(data.autoStartsAt).name}`
                : "Best available right now"
          }
          selected={value === undefined}
          onPick={() => pick(undefined)}
        />
        {data === null && <p className="ui-loki-model-note">Loading models…</p>}
        {(data?.options ?? []).map((option) => {
          const { name, blurb } = describeChatModel(option.id);
          const note = headroom.get(`${option.provider}/${option.id}`) ?? null;
          const spend = option.own ? ownSpend(option.provider, option.id) : null;
          return (
            <ModelRow
              key={`${option.provider}/${option.id}`}
              name={name}
              blurb={
                option.own
                  ? spend && spend.callsToday > 0
                    ? `Your key · ${providerName(option.provider)} · ${spend.tokensToday.toLocaleString("en-US")} tokens today`
                    : `Your key · ${providerName(option.provider)}`
                  : option.usable
                    ? note
                      ? `${note} · ${providerName(option.provider)}`
                      : `${blurb} · ${providerName(option.provider)}`
                    : `${providerName(option.provider)} has no key here — add yours below`
              }
              title={option.reason}
              selected={value === option.id}
              locked={!option.usable}
              onPick={() => pick(option.id)}
            />
          );
        })}
        {data !== null && (
          <a
            href={data.addKeyHref}
            className="ui-loki-model-row"
            role="option"
            aria-selected={false}
          >
            <span className="ui-loki-model-row-text">
              <span className="ui-loki-model-row-title">Add your own key</span>
              <span className="ui-loki-model-row-sub">
                Compare providers and prices — Loki thinks with the model you pay for, and the free
                budget no longer applies
              </span>
            </span>
            <KeyRound className="ui-loki-model-check" aria-hidden />
          </a>
        )}
      </div>
      {data !== null && (
        <p className="ui-loki-model-note">
          Loki starts with your pick. If it is busy or out of budget, the next one answers — your
          turn never just fails.
        </p>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="ui-loki-model-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ? `Starts at ${current}` : "Auto — best available model"}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{current}</span>
        <ChevronDown
          className={open ? "ui-loki-model-caret ui-loki-model-caret-open" : "ui-loki-model-caret"}
          aria-hidden
        />
      </button>

      {open && !phone && <div className="ui-loki-model-menu">{list}</div>}
      {open && phone && (
        <Modal
          onClose={() => setOpen(false)}
          position="bottom-mobile"
          padded={false}
          className="ui-sheet"
        >
          <div className="ui-sheet-grip" aria-hidden />
          <div className="ui-loki-model-sheet-head">
            <button
              type="button"
              className="ui-loki-topbar-btn"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <h2 className="flex-1 text-center text-base font-semibold text-text-primary">
              Choose a model
            </h2>
            <span className="w-11" aria-hidden />
          </div>
          <div className="ui-loki-model-sheet-body">{list}</div>
        </Modal>
      )}
    </div>
  );
}

/** One choice: the name, one line on what it is for, a check when chosen. */
function ModelRow({
  name,
  blurb,
  selected,
  locked = false,
  onPick,
  title,
}: {
  name: string;
  blurb: string;
  /** The precise reason on hover (e.g. which env var is missing). */
  title?: string;
  selected: boolean;
  locked?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={locked ? "ui-loki-model-row ui-loki-model-row-locked" : "ui-loki-model-row"}
      onClick={locked ? undefined : onPick}
      disabled={locked}
      role="option"
      aria-selected={selected}
      title={title}
    >
      <span className="ui-loki-model-row-text">
        <span className="ui-loki-model-row-title">{name}</span>
        <span className="ui-loki-model-row-sub">{blurb}</span>
      </span>
      {locked ? (
        <Lock className="ui-loki-model-check" aria-hidden />
      ) : (
        selected && <Check className="ui-loki-model-check" aria-hidden />
      )}
    </button>
  );
}

/** "groq" → "Groq", "openrouter" → "OpenRouter". */
function providerName(id: string): string {
  const known: Record<string, string> = {
    groq: "Groq",
    openrouter: "OpenRouter",
    openai: "OpenAI",
  };
  if (known[id]) return known[id];
  // A label already cased by its vendor ("xAI", from the user's own rows) stays as it is.
  return /[A-Z]/.test(id) ? id : id.charAt(0).toUpperCase() + id.slice(1);
}
