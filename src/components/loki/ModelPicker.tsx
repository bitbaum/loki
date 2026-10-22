"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Gauge, KeyRound, Lock, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getJson } from "@/lib/api/fetch";
import type { BudgetView } from "@/lib/ai/budget-view";
import {
  describeChatModel,
  partitionModelOptions,
  type LokiModelOption,
  type LokiModelsResponse,
} from "@/lib/loki/models";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

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
 *
 * ── Always visible ───────────────────────────────────────────────────────────
 * The button itself carries the count ("Auto · 12 left"), refreshed when each
 * answer finishes. Inside the menu was not enough: a person running several
 * things wants to know before they type, and asked for exactly that
 * (2026-10-15) after meeting the limit only as a refusal. Every model row says
 * what is left on it, not only a row about to run out.
 */
export function ModelPicker({
  value,
  onChange,
  disabled,
  busy = false,
}: {
  /** undefined = Auto (walk the whole chain). */
  value: string | undefined;
  onChange: (model: string | undefined) => void;
  disabled?: boolean;
  /** An answer is being written; when it finishes, the count is read again. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LokiModelsResponse | null>(null);
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery("(max-width: 767px)");

  // Refresh when opened: availability can change while this chat stays mounted.
  // Both requests share only the close guard; one finishing cannot cancel the other.
  useEffect(() => {
    if (!open) return;
    let live = true;
    getJson<LokiModelsResponse>("/api/loki/models")
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setLoadError("Couldn't load model choices. Try again.");
      });
    return () => {
      live = false;
    };
  }, [open, reload]);

  // The count, kept current without opening anything: on load, whenever an
  // answer finishes (`busy` falls), when the menu opens, and every two
  // minutes while the page is visible — answers free up through the day.
  // A budget that cannot be read is simply absent: "could not look" must
  // never draw as "nothing left".
  const [budgetTick, setBudgetTick] = useState(0);
  const [opens, setOpens] = useState(0);
  useEffect(() => {
    if (busy) return;
    let live = true;
    getJson<BudgetView>("/api/ai/budget")
      .then((b) => {
        // Only a reading with the free count in it is a budget. Read on load
        // now, not only on open, so a malformed reply must not crash the chat.
        if (live && isBudgetView(b)) setBudget(b);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [busy, opens, reload, budgetTick]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setBudgetTick((n) => n + 1);
    };
    const id = window.setInterval(tick, BUDGET_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

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

  const clearLoad = () => {
    setData(null);
    setLoadError(null);
  };

  const pick = (model: string | undefined) => {
    onChange(model);
    setOpen(false);
  };

  const current = value ? describeChatModel(value).name : "Auto";
  // The count on the button: own keys have no daily limit from Loki; a free
  // pick (or Auto with no keys) shows the day's free count.
  const onOwnKey =
    budget !== null &&
    budget.ownKeys.length > 0 &&
    (value === undefined || budget.ownKeys.some((k) => k.model === value));
  // On their own key there is nothing to count, so the chip says only the
  // model: "Auto your key" read as a broken sentence (owner, 2026-10-21). The
  // menu still says whose key answers.
  const countLabel = budget && !onOwnKey ? budget.freePool.short : null;
  const countOut =
    !onOwnKey &&
    budget !== null &&
    budget.freePool.state !== "ok" &&
    budget.freePool.state !== "none";

  // What a vendor last said about a free row, and what is left on it, keyed as the rows are.
  const headroom = new Map((budget?.models ?? []).map((m) => [m.id, m.note]));
  const leftOn = new Map((budget?.models ?? []).map((m) => [m.id, m.left]));
  // What the person's own key spent today, matched by the label the row shows.
  const ownSpend = (label: string, model: string) =>
    budget?.ownKeys.find((k) => k.label === label && k.model === model) ?? null;

  const choices = partitionModelOptions(
    data?.options ?? [],
    budget?.models ?? [],
    budget?.freePool?.state,
  );
  const sharedSelection = [...choices.available, ...choices.unavailable].some(
    (option) => option.id === value && !option.own,
  );
  const row = (option: LokiModelOption, locked: boolean) => {
    const { name, blurb } = describeChatModel(option.id);
    const note =
      !option.own && budget?.freePool && budget.freePool.state !== "ok"
        ? budget.freePool.line
        : (headroom.get(`${option.provider}/${option.id}`) ?? null);
    const spend = option.own ? ownSpend(option.provider, option.id) : null;
    const left = option.own
      ? spend?.left
        ? spend.left.short
        : spend && spend.callsToday > 0
          ? `No daily limit from Loki · ${spend.callsToday.toLocaleString("en-US")} ${spend.callsToday === 1 ? "answer" : "answers"} today`
          : "No daily limit from Loki"
      : option.usable && budget
        ? (leftOn.get(`${option.provider}/${option.id}`) ?? budget.freePool.short ?? undefined)
        : undefined;
    return (
      <ModelRow
        key={`${option.provider}/${option.id}`}
        name={name}
        blurb={
          option.own
            ? `Your key · ${providerName(option.provider)}`
            : option.usable
              ? `${blurb} · ${providerName(option.provider)}`
              : `${option.reason ?? note ?? "Not available on this connection"} · ${providerName(option.provider)}`
        }
        title={option.reason ?? note ?? undefined}
        left={left}
        selected={value === option.id}
        locked={locked}
        onPick={() => pick(option.id)}
      />
    );
  };

  // One list, two containers: a popover above the composer on a laptop, a
  // bottom sheet on a phone (where a popover is a cramped box under a thumb).
  const list = (
    <>
      <div className="ui-loki-model-card">
        {budget && (
          <a href={OWN_MODEL_SETTINGS_PATH} className="ui-loki-model-budget">
            <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
            <span>
              {sharedSelection && budget.freePool ? budget.freePool.line : budget.headline}
            </span>
          </a>
        )}
        <ModelRow
          name="Auto"
          blurb={
            data?.autoSummary
              ? data.autoSummary.replace(/^Auto · /, "")
              : "Chooses for each request, with available alternatives"
          }
          selected={value === undefined}
          onPick={() => pick(undefined)}
        />
        {data === null && !loadError && (
          <p className="ui-loki-model-note" role="status">
            Loading models…
          </p>
        )}
        {loadError && (
          <div className="ui-loki-model-note" role="alert">
            <p>{loadError}</p>
            <button
              type="button"
              className="ui-btn-secondary mt-2"
              onClick={() => {
                clearLoad();
                setReload((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {choices.available.map((option) => row(option, false))}
        {choices.unavailable.length > 0 && (
          <details open={choices.unavailable.some((option) => option.id === value)}>
            <summary className="ui-tap cursor-pointer px-4 text-sm text-text-secondary">
              Unavailable right now ({choices.unavailable.length})
            </summary>
            {choices.unavailable.map((option) => row(option, true))}
          </details>
        )}
        {data !== null && (
          <a href={data.addKeyHref} className="ui-loki-model-row">
            <span className="ui-loki-model-row-text">
              <span className="ui-loki-model-row-title">Add your own key</span>
              <span className="ui-loki-model-row-sub">
                Compare providers and prices, or connect a model you pay for.
              </span>
            </span>
            <KeyRound className="ui-loki-model-check" aria-hidden />
          </a>
        )}
      </div>
      {data !== null && (
        <p className="ui-loki-model-note">
          Loki starts with your pick and tries available alternatives if it is busy or out of
          budget.
        </p>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="ui-loki-model-trigger"
        onClick={() => {
          if (!open) {
            clearLoad();
            setOpens((n) => n + 1);
          }
          setOpen((v) => !v);
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Loki answers with: ${current}${budget ? ` — ${budget.headline}` : ""}`}
        title={
          budget ? budget.headline : value ? `Starts at ${current}` : "Auto — best available model"
        }
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span
          className={
            countLabel ? "ui-loki-model-name ui-loki-model-name-counted" : "ui-loki-model-name"
          }
        >
          {current}
        </span>
        {countLabel && (
          <span
            className={
              countOut ? "ui-loki-model-left ui-loki-model-left-out" : "ui-loki-model-left"
            }
          >
            <span className="ui-loki-model-left-long">
              <span className="max-sm:hidden">· </span>
              {countLabel}
            </span>
            <span className="ui-loki-model-left-tiny">
              {countLabel.replace(/ left$/, "").replace(/^next /, "")}
            </span>
          </span>
        )}
        <ChevronDown
          className={[
            "ui-loki-model-caret",
            open ? "ui-loki-model-caret-open" : "",
            countLabel ? "ui-loki-model-caret-counted" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden
        />
      </button>

      {open && !phone && (
        <div className="ui-loki-model-menu" role="dialog" aria-label="Loki answers with">
          {list}
        </div>
      )}
      {open && phone && (
        <Modal
          onClose={() => setOpen(false)}
          position="bottom-mobile"
          padded={false}
          className="ui-sheet"
          labelledBy={headingId}
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
            <h2
              id={headingId}
              className="flex-1 text-center text-base font-semibold text-text-primary"
            >
              Loki answers with
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
  left,
  selected,
  locked = false,
  onPick,
  title,
}: {
  name: string;
  blurb: string;
  /** What is left on this model, in words — every usable row says it. */
  left?: string;
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
      aria-pressed={selected}
      title={title}
    >
      <span className="ui-loki-model-row-text">
        <span className="ui-loki-model-row-title">{name}</span>
        <span className="ui-loki-model-row-sub">{blurb}</span>
        {left && <span className="ui-loki-model-row-left">{left}</span>}
      </span>
      {locked ? (
        <Lock className="ui-loki-model-check" aria-hidden />
      ) : (
        selected && <Check className="ui-loki-model-check" aria-hidden />
      )}
    </button>
  );
}

function isBudgetView(b: unknown): b is BudgetView {
  if (!b || typeof b !== "object") return false;
  const v = b as Partial<BudgetView>;
  return (
    typeof v.headline === "string" &&
    !!v.freePool &&
    typeof v.freePool.state === "string" &&
    Array.isArray(v.ownKeys) &&
    Array.isArray(v.models)
  );
}

/** Answers free up through the day; read the count again this often while visible. */
const BUDGET_REFRESH_MS = 2 * 60_000;

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
