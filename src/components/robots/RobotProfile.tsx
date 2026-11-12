"use client";

import { useState } from "react";
import { OptionRow } from "@/components/terminal/sheet-rows";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RobotWithAttributes } from "@/db/queries/robots";
import {
  MARKET_OFFERS,
  MARKET_OFFER_LABEL,
  ROBOT_CLASSES,
  ROBOT_CLASS_LABEL,
  type MarketOffer,
  type RobotClass,
} from "@/config/actors";
import { patchJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { Field } from "@/components/ui/form";

export function RobotProfile({ robot }: { robot: RobotWithAttributes }) {
  const router = useRouter();
  const [name, setName] = useState(robot.name);
  const [robotClass, setRobotClass] = useState<RobotClass>(robot.robotClass ?? "other");
  const [make, setMake] = useState(robot.make ?? "");
  const [model, setModel] = useState(robot.model ?? "");
  const [description, setDescription] = useState(robot.description ?? "");
  const [market, setMarket] = useState(robot.market);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingNote, setListingNote] = useState<string | null>(
    robot.orangecatAssetId ? `Listed on OrangeCat as ${robot.orangecatAssetId}.` : null,
  );

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await patchJson(`/api/robots/${robot.id}`, patch);
      if (!res.ok) await throwApiError(res, "Failed to update robot");
      const data = (await res.json()) as {
        robot?: {
          orangecatAssetId?: string | null;
          listing?: { published?: boolean; reason?: string; assetId?: string | null };
        };
      };
      const listing = data.robot?.listing;
      if (listing) {
        if (listing.published && listing.assetId) {
          setListingNote(`Listed on OrangeCat as ${listing.assetId}.`);
        } else if (listing.reason === "orangecat-not-configured") {
          setListingNote(
            "Offer saved here. OrangeCat is not connected — listing is not public yet.",
          );
        } else if (listing.reason) {
          setListingNote(`Offer saved here. OrangeCat listing failed: ${listing.reason}`);
        }
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffer(offer: MarketOffer) {
    const next = !market[offer];
    setMarket((prev) => ({ ...prev, [offer]: next }));
    const ok = await save({ market: { [offer]: next } });
    if (!ok) setMarket((prev) => ({ ...prev, [offer]: !next }));
  }

  async function remove() {
    if (!window.confirm(`Remove ${robot.name} from your book?`)) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await deleteJson(`/api/robots/${robot.id}`);
      if (!res.ok) await throwApiError(res, "Failed to remove robot");
      router.push("/robots");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Field label="Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== robot.name) void save({ name: name.trim() });
            }}
            className="ui-input"
          />
        </Field>
        <Field label="Class" required>
          <select
            value={robotClass}
            onChange={(e) => {
              const next = e.target.value as RobotClass;
              setRobotClass(next);
              void save({ class: next });
            }}
            className="ui-input"
          >
            {ROBOT_CLASSES.map((value) => (
              <option key={value} value={value}>
                {ROBOT_CLASS_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Make">
            <input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              onBlur={() => {
                if (make !== (robot.make ?? "")) void save({ make: make.trim() || null });
              }}
              placeholder="e.g. iRobot"
              className="ui-input"
            />
          </Field>
          <Field label="Model">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => {
                if (model !== (robot.model ?? "")) void save({ model: model.trim() || null });
              }}
              placeholder="e.g. Roomba j7+"
              className="ui-input"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== (robot.description ?? "")) void save({ description });
            }}
            rows={3}
            className="ui-input"
          />
        </Field>
      </div>

      <section className="space-y-3">
        <h2 className="ui-kicker">Marketplace</h2>
        <p className="text-sm text-text-secondary">
          A robot can be booked, rented, or sold. A person cannot. Listing publishes to OrangeCat as
          an asset — checkout is not live yet.
        </p>
        <div className="flex flex-col gap-1">
          {MARKET_OFFERS.map((offer) => (
            <OptionRow
              toggle
              key={offer}
              title={MARKET_OFFER_LABEL[offer]}
              active={market[offer]}
              disabled={saving}
              onSelect={() => void toggleOffer(offer)}
            />
          ))}
        </div>
        <p className="text-sm text-text-secondary">
          {listingNote ??
            (robot.orangecatAssetId
              ? `Listed on OrangeCat as ${robot.orangecatAssetId}.`
              : "Flip an offer on to list this machine on OrangeCat. People cannot be listed.")}
        </p>
      </section>

      {error && <p className="ui-error-xs">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/robots" className="ui-link-subtle">
          Back to robots
        </Link>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={removing}
          className="ui-link-subtle text-status-negative"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}
