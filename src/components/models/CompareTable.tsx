"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { byokVendor } from "@bitbaum/ai-kit/byok";
import type { StoreModel } from "@/lib/models/store-catalog";
import { ownModelAddPath } from "@/lib/own-model-path";
import { money, contextLabel } from "./format";

type Key = "out" | "in" | "context" | "released";

/**
 * Every featured model, one table, sortable by the numbers that decide a
 * bill: what you pay to read, what you pay to write, how much fits, how new.
 * Default order is price to write, cheapest first — the cost that dominates
 * a chat. "Use" opens Settings with the vendor and model already chosen.
 */
export function CompareTable({ models }: { models: StoreModel[] }) {
  const [key, setKey] = useState<Key>("out");
  const [asc, setAsc] = useState(true);

  const rows = [...models].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return asc ? va - vb : vb - va;
  });

  const head = (k: Key, label: string) => (
    <th scope="col" aria-sort={key === k ? (asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="ui-store-sort"
        onClick={() => {
          if (key === k) setAsc((v) => !v);
          else {
            setKey(k);
            setAsc(k !== "released");
          }
        }}
      >
        {label}
        {key === k ? (
          asc ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );

  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">Live prices could not be read just now.</p>;
  }

  return (
    <div className="ui-store-table-wrap">
      <table className="ui-store-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Provider</th>
            {head("in", "$ / 1M in")}
            {head("out", "$ / 1M out")}
            {head("context", "Context")}
            {head("released", "Listed")}
            <th scope="col">
              <span className="sr-only">Use</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="text-text-primary">
                {m.name}
                {m.isNew && <span className="ui-tag ui-tag-accent ml-2">new</span>}
              </td>
              <td>{byokVendor(m.vendor as never)?.label ?? m.vendor}</td>
              <td className="ui-store-num">{cell(m.inPerM, m.free)}</td>
              <td className="ui-store-num">{cell(m.outPerM, m.free)}</td>
              <td className="ui-store-num">{contextLabel(m.context) || "—"}</td>
              <td className="ui-store-num">
                {m.released ? new Date(m.released).toLocaleDateString() : "—"}
              </td>
              <td>
                <Link href={ownModelAddPath(m.vendor, m.model)} className="ui-btn-ghost text-xs">
                  Use
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function valueOf(m: StoreModel, key: Key): number | null {
  switch (key) {
    case "in":
      return m.inPerM;
    case "out":
      return m.outPerM;
    case "context":
      return m.context;
    case "released":
      return m.released;
  }
}

function cell(perM: number | null, free: boolean): string {
  if (free) return "free";
  if (perM === null) return "varies";
  return `$${money(perM)}`;
}
