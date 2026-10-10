"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, KeyRound, Loader2, RefreshCw, Sparkles, Ticket, Users } from "lucide-react";
import { byokVendor } from "@bitbaum/ai-kit/byok";
import type { StoreVendor } from "@/config/model-store";
import type { StoreModel } from "@/lib/models/store-catalog";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import { VendorCard } from "./VendorCard";
import { CompareTable } from "./CompareTable";

export type StoreVendorData = Omit<StoreVendor, "namespaces"> & {
  namespaces: string[];
  connected: { model: string; startsHere: boolean } | null;
  featured: StoreModel[];
  all: StoreModel[];
  recentCount: number;
};

export type ModelStoreData = {
  fetchedAt: number | null;
  vendors: StoreVendorData[];
};

/**
 * The store. Three honest sentences about how Loki runs, then every provider
 * a person can bring with live prices and one tap to add a key, then the
 * table that lets price be compared across all of them.
 *
 * The free pool is explained as what it is — models the vendors let Loki use
 * at no charge, shared by everyone here — because a person deciding whether
 * to bring a key deserves to know that the free pool is finite and theirs is
 * not. The store never says one model is better than another: price is the
 * one number every vendor publishes, and quality is theirs to judge with the
 * Test button and their own questions.
 */
export function ModelStore({ initial }: { initial: ModelStoreData }) {
  const [data, setData] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const connected = data.vendors.filter((v) => v.connected);
  const totalNew = data.vendors.reduce((n, v) => n + v.recentCount, 0);

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
      const before = new Set(data.vendors.flatMap((v) => v.all.map((m) => m.id)));
      const added = next.vendors.flatMap((v) => v.all).filter((m) => !before.has(m.id));
      setData(next);
      setNote(
        added.length === 0
          ? "Checked just now — nothing new since the last read."
          : `${added.length} new model${added.length === 1 ? "" : "s"} since the last read: ${added
              .slice(0, 4)
              .map((m) => m.model)
              .join(", ")}${added.length > 4 ? "…" : ""}.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't check just now.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* How Loki runs — three ways, in the order a person meets them. */}
      <section aria-labelledby="ways" className="space-y-3">
        <h2 id="ways" className="ui-section-label">
          Three ways Loki thinks
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Way
            icon={Users}
            title="The free pool"
            tone="neutral"
            body="Models the vendors let Loki use at no charge — shared by everyone here and rationed per person. When it is spent for the day, it is spent for everyone until it resets. Good for a first look; not a plan."
          />
          <Way
            icon={KeyRound}
            title="Your own keys"
            tone="accent"
            body="You pay the lab directly for what you use; Loki charges nothing. Any model your key can reach, the daily budget no longer applies, and a spending cap at the lab protects you. Bring two and Auto has a choice."
          />
          <Way
            icon={Ticket}
            title="A Loki pass"
            tone="neutral"
            body="Pays for Loki itself — room for more projects — never for tokens. Paid in Bitcoin, a month at a time. The two are independent: a stronger model is a key away on every plan."
          />
        </div>
      </section>

      {/* Where this person stands. */}
      <section aria-labelledby="yours" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="yours" className="ui-section-label">
            Your keys
          </h2>
          <Link href={OWN_MODEL_SETTINGS_PATH} className="text-xs text-accent-text">
            Manage in Settings →
          </Link>
        </div>
        {connected.length === 0 ? (
          <p className="ui-callout-accent">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              No keys yet — Loki answers you from the free pool. Pick a provider below, paste a key,
              and Loki thinks with it from the next message. Five francs with a spending limit is
              enough to find out how a model thinks.
            </span>
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-2">
              {connected.map((v) => (
                <li key={v.id} className="ui-tag ui-tag-positive">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  {byokVendor(v.id)?.label ?? v.id} · {v.connected!.model}
                  {v.connected!.startsHere ? " · starts here" : ""}
                </li>
              ))}
            </ul>
            {connected.length === 1 && (
              <p className="text-sm text-text-secondary">
                One provider means one point of failure. Add a second and Auto has a choice: when
                the first is slow, down or out of credit, the next answers — and you can compare how
                two models think on the same question.
              </p>
            )}
          </div>
        )}
      </section>

      {/* The providers. */}
      <section aria-labelledby="providers" className="space-y-3">
        <h2 id="providers" className="ui-section-label">
          Providers
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {data.vendors.map((v) => (
            <VendorCard key={v.id} vendor={v} />
          ))}
        </div>
      </section>

      {/* Price, side by side. */}
      <section aria-labelledby="compare" className="space-y-3">
        <div>
          <h2 id="compare" className="ui-section-label">
            Compare
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Price is the one number every vendor publishes. Quality is yours to judge: add a key,
            tap Test, ask the same question twice.
          </p>
        </div>
        <CompareTable models={data.vendors.flatMap((v) => v.featured)} />
      </section>

      {/* Freshness, stated, with the button that makes it true again. */}
      <section className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4 text-xs text-text-muted">
        <span className="min-w-0 flex-1">
          Prices and release dates from OpenRouter&apos;s public catalogue
          {data.fetchedAt ? `, read ${ago(data.fetchedAt)}` : " — could not be read just now"}. The
          vendor&apos;s own price page is the bill. The descriptions were last checked on{" "}
          {data.vendors[0]?.asOf}.
          {totalNew > 0
            ? ` ${totalNew} model${totalNew === 1 ? "" : "s"} listed in the last 30 days.`
            : ""}
        </span>
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
        {note && (
          <span className="basis-full text-text-secondary" role="status">
            {note}
          </span>
        )}
      </section>
    </div>
  );
}

function Way({
  icon: Icon,
  title,
  body,
  tone,
}: {
  icon: typeof Users;
  title: string;
  body: string;
  tone: "neutral" | "accent";
}) {
  return (
    <div className={tone === "accent" ? "ui-store-way ui-store-way-accent" : "ui-store-way"}>
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Icon className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        {title}
      </p>
      <p className="text-sm text-text-secondary">{body}</p>
    </div>
  );
}

function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}
