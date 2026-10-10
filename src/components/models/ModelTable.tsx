"use client";

import Link from "next/link";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { CUSTOM_VENDOR_ID, vendorById, type VendorId } from "@/config/model-vendors";
import { runsVia, valueScore, type RunsVia, type StoreModel } from "@/lib/models/store-catalog";
import { ownModelAddPath } from "@/lib/own-model-path";
import { contextLabel, indexLabel, money, releasedLabel } from "./format";

/**
 * The landscape as a table: one row per model, the numbers the decision is
 * made on, every way to run it through Loki, and the one button that does
 * the obvious thing — "Use" on a key you hold, "Add key" when you don't.
 *
 * Under 768px the same markup reads as cards (globals.css turns each row
 * into a block with its cells labelled), so a phone never scrolls sideways.
 */
const REGION: Record<string, string> = { US: "US", EU: "EU", CN: "China" };

export type UseState = { via: RunsVia; state: "saving" | "done" } | null;

export function ModelTable({
  models,
  connected,
  using,
  onUse,
}: {
  models: StoreModel[];
  connected: ReadonlySet<string>;
  /** The row being switched to, so the button can say so. */
  using: UseState;
  onUse: (m: StoreModel, via: RunsVia) => void;
}) {
  if (models.length === 0) {
    return (
      <p className="ui-empty-page text-sm text-text-muted">
        No model matches those filters. Clear one and look again.
      </p>
    );
  }
  return (
    <div className="ui-store-table-wrap">
      <table className="ui-store-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" title="Artificial Analysis intelligence index, 0–100">
              Intelligence
            </th>
            <th scope="col" title="USD per million tokens, in and out">
              Price
            </th>
            <th scope="col">Context</th>
            <th scope="col">Listed</th>
            <th scope="col">Runs via</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <ModelRow key={m.id} m={m} connected={connected} using={using} onUse={onUse} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelRow({
  m,
  connected,
  using,
  onUse,
}: {
  m: StoreModel;
  connected: ReadonlySet<string>;
  using: UseState;
  onUse: (m: StoreModel, via: RunsVia) => void;
}) {
  const vias = runsVia(m, connected);
  const live = vias.find((v) => v.connected);
  const first = vias[0]!;
  const region = m.vendor ? vendorById(m.vendor)?.region : null;
  const value = valueScore(m);
  const busy =
    using?.via.model === first.model && using.via.vendor === (live?.vendor ?? first.vendor);
  return (
    <tr>
      <td data-label="Model" className="ui-store-cell-model">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium text-text-primary" title={m.id}>
            {m.name}
          </span>
          <span className="truncate text-xs text-text-muted">
            {m.labLabel}
            {region && REGION[region] ? ` · ${REGION[region]}` : ""}
          </span>
          <span className="flex flex-wrap gap-1">
            <span className={m.open ? "ui-store-badge-open" : "ui-store-badge-closed"}>
              {m.open ? "Open weights" : "Closed"}
            </span>
            {m.isNew && <span className="ui-tag ui-tag-accent">New</span>}
            {(m.free || m.freeVariant) && <span className="ui-tag ui-tag-positive">Free tier</span>}
            {m.vision && <span className="ui-tag ui-tag-neutral">Vision</span>}
            {m.reasoning && <span className="ui-tag ui-tag-neutral">Reasoning</span>}
          </span>
        </div>
      </td>
      <td data-label="Intelligence" className="ui-store-num">
        <span className="flex items-center gap-2">
          <span className="w-6 text-right">{indexLabel(m.index)}</span>
          <span className="ui-store-index" aria-hidden="true">
            {m.index !== null && <i style={{ width: `${Math.max(2, Math.round(m.index))}%` }} />}
          </span>
        </span>
        {value !== null && <span className="block text-xs text-text-muted">value {value}</span>}
      </td>
      <td data-label="Price" className="ui-store-num">
        {m.free ? (
          <span className="text-status-positive">free</span>
        ) : m.inPerM === null || m.outPerM === null ? (
          <span className="text-text-muted">varies</span>
        ) : (
          <>
            <span>${money(m.inPerM)}</span>
            <span className="text-text-muted"> in</span>
            <span className="block">
              ${money(m.outPerM)}
              <span className="text-text-muted"> out</span>
            </span>
          </>
        )}
      </td>
      <td data-label="Context" className="ui-store-num">
        {contextLabel(m.context).replace(" ctx", "") || "—"}
      </td>
      <td data-label="Listed" className="ui-store-num">
        {releasedLabel(m.released) || "—"}
      </td>
      <td data-label="Runs via">
        <span className="flex flex-wrap gap-1">
          {vias.map((v) => (
            <span
              key={v.vendor}
              className={v.connected ? "ui-store-via ui-store-via-on" : "ui-store-via"}
              title={
                v.connected
                  ? `You hold a ${viaLabel(v.vendor)} key`
                  : `Add a ${viaLabel(v.vendor)} key to run it there`
              }
            >
              {v.connected && <Check className="h-3 w-3" aria-hidden="true" />}
              {viaLabel(v.vendor, m.vendor)}
            </span>
          ))}
        </span>
      </td>
      <td data-label="">
        {live ? (
          <button
            type="button"
            className="ui-btn-secondary text-xs"
            disabled={Boolean(using)}
            onClick={() => onUse(m, live)}
            title={`Loki thinks with this model on your ${viaLabel(live.vendor)} key`}
          >
            {busy && using?.state === "saving" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : busy && using?.state === "done" ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : null}
            Use
          </button>
        ) : (
          <Link
            href={ownModelAddPath(first.vendor, first.model)}
            className="ui-btn-secondary text-xs"
            title={`Add a ${viaLabel(first.vendor)} key with this model chosen`}
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Add key
          </Link>
        )}
      </td>
    </tr>
  );
}

/** "Direct" for the lab's own key, the router's name, or "Your endpoint". */
function viaLabel(vendor: VendorId, labVendor?: VendorId | null): string {
  if (vendor === CUSTOM_VENDOR_ID) return "Your endpoint";
  if (labVendor && vendor === labVendor) return "Direct";
  return vendorById(vendor)?.label ?? vendor;
}
