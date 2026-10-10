"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { CUSTOM_VENDOR_ID, vendorById } from "@/config/model-vendors";
import { runsVia, type RunsVia, type StoreModel } from "@/lib/models/store-catalog";
import type { ModelStoreData } from "@/lib/models/store-data";
import {
  STORE_SORTS,
  applyFilters,
  parseFilters,
  serializeFilters,
  sortModels,
} from "@/lib/models/store-filters";
import { OWN_MODEL_SETTINGS_PATH, ownModelAddPath } from "@/lib/own-model-path";
import { ownModelRequest } from "@/lib/own-model-client";
import { AutoRouting } from "./AutoRouting";
import { LocalModels } from "./LocalModels";
import { ModelTable, type UseState } from "./ModelTable";
import { StoreToolbar } from "./StoreToolbar";

/**
 * The store. Your keys in one line, the controls, the table, the way to run
 * a model on your own machine, and where the numbers come from.
 *
 * Loki is model-agnostic on purpose: the person decides who thinks for them
 * and who they pay. That decision needs the whole landscape, honest numbers
 * from one live source, and a way to narrow it to what matters to THEM —
 * open weights, a price, a region, images. The store never says a model is
 * better; it shows the index and the price and lets the person rank.
 */
const PAGE = 60;

export function ModelStore({ initial }: { initial: ModelStoreData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState(() =>
    parseFilters(new URLSearchParams(searchParams.toString())),
  );
  const [shown, setShown] = useState(PAGE);
  const [checking, setChecking] = useState(false);
  const [using, setUsing] = useState<UseState>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // The URL carries the filters, so a view is a link; only non-defaults, so
  // a plain /models stays plain.
  useEffect(() => {
    const qs = serializeFilters(filters);
    const current = searchParams.toString();
    if (qs === current) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router, searchParams]);

  const connected = useMemo(() => new Set(data.connected.map((c) => c.vendor)), [data]);
  const visible = useMemo(
    () =>
      sortModels(
        applyFilters(data.models, filters, (m) => runsVia(m, connected).some((v) => v.connected)),
        filters.sort,
      ),
    [data.models, filters, connected],
  );
  const sort = STORE_SORTS.find((s) => s.id === filters.sort)!;

  async function checkForNew() {
    setChecking(true);
    setNote(null);
    try {
      const res = await fetch("/api/models/catalog?refresh=1");
      const body = (await res.json().catch(() => ({}))) as Partial<ModelStoreData> & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next = body as ModelStoreData;
      const before = new Set(data.models.map((m) => m.id));
      const added = next.models.filter((m) => !before.has(m.id));
      setData(next);
      setNote({
        tone: "ok",
        text:
          added.length === 0
            ? "Checked just now — nothing new since the last read."
            : `${added.length} new model${added.length === 1 ? "" : "s"} since the last read: ${added
                .slice(0, 4)
                .map((m) => m.name)
                .join(", ")}${added.length > 4 ? "…" : ""}.`,
      });
    } catch (e) {
      setNote({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't check just now." });
    } finally {
      setChecking(false);
    }
  }

  /** "Use": the model on a key already held — one PUT, keep the key, say what changed. */
  async function useModel(m: StoreModel, via: RunsVia) {
    setUsing({ via, state: "saving" });
    setNote(null);
    try {
      await ownModelRequest("/api/settings/model", "PUT", { vendor: via.vendor, model: via.model });
      setData((d) => ({
        ...d,
        connected: d.connected.map((c) =>
          c.vendor === via.vendor ? { ...c, model: via.model } : c,
        ),
      }));
      setUsing({ via, state: "done" });
      const who =
        via.vendor === CUSTOM_VENDOR_ID
          ? "your endpoint"
          : `your ${vendorById(via.vendor)?.label ?? via.vendor} key`;
      setNote({ tone: "ok", text: `Loki now thinks with ${m.name} on ${who}.` });
    } catch (e) {
      setUsing(null);
      setNote({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't switch model." });
    }
    setTimeout(() => setUsing(null), 1500);
  }

  // An absolute time, not "N min ago": the page is server-rendered once and
  // a relative figure would be wrong from the second minute on.
  const readAt =
    data.fetchedAt === null
      ? null
      : new Date(data.fetchedAt).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });

  return (
    <div className="space-y-6">
      {/* Your keys — one line, never a wall. */}
      <section aria-label="Your keys" className="ui-store-keys">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          {data.connected.length === 0 ? (
            <p className="text-text-secondary">
              Loki answers you on its shared free pool. Bring one key — five francs with a spending
              limit — and any model below is yours; bring two and Auto has a choice.{" "}
              <Link
                href={ownModelAddPath("openrouter")}
                className="text-accent-text underline-offset-2 hover:underline"
              >
                Add a key →
              </Link>
            </p>
          ) : (
            <p className="text-text-secondary">
              <span className="text-text-primary">Your keys:</span>{" "}
              {data.connected.map((c, i) => (
                <span key={c.vendor}>
                  {i > 0 && " · "}
                  {c.vendor === CUSTOM_VENDOR_ID
                    ? (c.label ?? "Your endpoint")
                    : (vendorById(c.vendor)?.label ?? c.vendor)}{" "}
                  <span className="text-text-muted">{c.model}</span>
                </span>
              ))}
              .{" "}
              <Link
                href={OWN_MODEL_SETTINGS_PATH}
                className="text-accent-text underline-offset-2 hover:underline"
              >
                Manage →
              </Link>
            </p>
          )}
        </div>
      </section>

      {data.connected.length > 0 && <AutoRouting compact />}

      <StoreToolbar
        filters={filters}
        labs={data.labs}
        hasKeys={data.connected.length > 0}
        onChange={(next) => {
          setFilters(next);
          setShown(PAGE);
        }}
      />

      {note && (
        <p
          className={note.tone === "ok" ? "ui-callout-positive" : "ui-callout-warning"}
          role="status"
        >
          {note.text}
        </p>
      )}

      <p className="text-xs text-text-muted" aria-live="polite">
        {visible.length} of {data.models.length} models · {sort.label.toLowerCase()} first (
        {sort.explains})
      </p>

      <ModelTable
        models={visible.slice(0, shown)}
        connected={connected}
        using={using}
        onUse={useModel}
      />
      {visible.length > shown && (
        <button
          type="button"
          className="ui-btn-secondary text-sm"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show {Math.min(PAGE, visible.length - shown)} more
        </button>
      )}

      <LocalModels hasEndpoint={connected.has(CUSTOM_VENDOR_ID)} />

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4 text-xs text-text-muted">
        <p className="max-w-prose">
          Prices, context and dates from OpenRouter&apos;s public catalogue
          {readAt === null ? " — not read yet" : ` (read at ${readAt})`}. Intelligence is Artificial
          Analysis&apos; index as OpenRouter relays it; &quot;open weights&quot; means the lab
          published them on Hugging Face. The lab&apos;s own page is what you are billed by.
        </p>
        <button
          type="button"
          className="ui-btn-secondary text-xs"
          onClick={() => void checkForNew()}
          disabled={checking}
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Check for new models
        </button>
      </footer>
    </div>
  );
}
