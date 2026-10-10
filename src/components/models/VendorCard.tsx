"use client";

import Link from "next/link";
import { Check, ExternalLink, Plus } from "lucide-react";
import { byokVendor } from "@bitbaum/ai-kit/byok";
import { ownModelAddPath, OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import type { StoreVendorData } from "./ModelStore";
import { priceLabel, contextLabel } from "./format";

/**
 * One provider: who they are, what they are known for, what they give away,
 * their newest models with live prices, and the one button that matters —
 * Add to Loki, which opens Settings with this vendor already chosen.
 */
export function VendorCard({ vendor }: { vendor: StoreVendorData }) {
  const info = byokVendor(vendor.id);
  const label = info?.label ?? vendor.id;
  const isHost = vendor.namespaces.length === 0;
  return (
    <article className="ui-store-card" aria-labelledby={`vendor-${vendor.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`vendor-${vendor.id}`} className="text-base font-medium text-text-primary">
          {label}
        </h3>
        {vendor.connected && (
          <span className="ui-tag ui-tag-positive">
            <Check className="h-3 w-3" aria-hidden="true" />
            {vendor.connected.startsHere ? "Loki starts here" : "Connected"}
          </span>
        )}
        {vendor.freeTier && <span className="ui-tag ui-tag-neutral">free tier</span>}
        {vendor.recentCount > 0 && (
          <span className="ui-tag ui-tag-accent">{vendor.recentCount} new this month</span>
        )}
      </header>

      <p className="text-sm text-text-secondary">{vendor.blurb}</p>
      <p className="text-xs text-text-tertiary">
        <span className="text-text-secondary">Known for:</span> {vendor.knownFor}
        {vendor.freeTier ? (
          <>
            {" "}
            · <span className="text-text-secondary">Free:</span> {vendor.freeTier}
          </>
        ) : null}
      </p>

      {isHost ? (
        <p className="text-xs text-text-tertiary">
          <span className="text-text-secondary">Serves:</span> {vendor.hosts}. Prices on their page;
          usually a fraction of a frontier lab&apos;s.
        </p>
      ) : vendor.featured.length > 0 ? (
        <ul className="ui-store-models">
          {vendor.featured.map((m) => (
            <li key={m.id} className="ui-store-model">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-text-primary">{m.name}</span>
                {m.isNew && <span className="ui-tag ui-tag-accent ml-2">new</span>}
              </span>
              <span className="ui-store-price">{priceLabel(m)}</span>
              <span className="ui-store-ctx">{contextLabel(m.context)}</span>
            </li>
          ))}
          {vendor.all.length > vendor.featured.length && (
            <li className="pt-1 text-xs text-text-muted">
              and {vendor.all.length - vendor.featured.length} more in the table below
            </li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">Live prices could not be read just now.</p>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {vendor.connected ? (
          <Link href={OWN_MODEL_SETTINGS_PATH} className="ui-btn-secondary text-xs">
            Your key · {vendor.connected.model}
          </Link>
        ) : (
          <Link href={ownModelAddPath(vendor.id)} className="ui-btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add to Loki
          </Link>
        )}
        {info && (
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn-ghost text-xs"
          >
            Get a key <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
        <a
          href={vendor.pricingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-btn-ghost text-xs"
        >
          Prices <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}
