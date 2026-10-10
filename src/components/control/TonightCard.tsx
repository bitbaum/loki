"use client";

import { Moon } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { ActionButtons } from "@/components/today/ActionButtons";
import { ACTION_STATUS } from "@/lib/constants/statuses";
import { NAV } from "@/config/navigation";
import Link from "next/link";

type Tonight = {
  night: string;
  plan: {
    actionId: string;
    status: string;
    body: string;
    reason: string | null;
    allowed: boolean;
  } | null;
  allowance: { until: string | null; capUsd: number | null };
};

/**
 * Tonight, on Control: what autopilot would build, what it would cost, and
 * the one decision — Approve / Reject — on the same card. Approved, it says
 * so; under an allowance it says until when; nothing planned, nothing shown.
 *
 * Replaces the late-night "go to sleep, autopilot has it" strip (2026-10-10):
 * that one offered a switch; this one shows the plan and the price, because
 * nothing runs at night that the owner has not seen (or explicitly allowed).
 */
export function TonightCard() {
  const { data } = useFetch<Tonight>("/api/autopilot/tonight");
  if (!data?.plan) return null;
  const { plan, allowance } = data;
  if (plan.status === ACTION_STATUS.EXECUTED || plan.status === ACTION_STATUS.EXPIRED) return null;

  const status =
    plan.status === ACTION_STATUS.DRAFT
      ? "Waiting for your yes — nothing runs without it."
      : plan.status === ACTION_STATUS.REJECTED
        ? "Not tonight. The free parts still happen."
        : plan.allowed && allowance.until
          ? `Runs without asking until ${allowance.until.slice(0, 10)}${
              allowance.capUsd != null ? `, up to $${allowance.capUsd.toFixed(2)} a night` : ""
            }.`
          : "Approved — runs at 02:30 UTC.";

  return (
    <section className="ui-away" aria-label="Tonight">
      <div className="ui-away-head">
        <p className="ui-away-title inline-flex items-center gap-2">
          <Moon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          Tonight
        </p>
        <Link href={`${NAV.settings.href}#autopilot`} className="ui-link-muted text-xs">
          Allowance
        </Link>
      </div>
      <p className="mt-1 text-sm text-text-secondary">{plan.body}</p>
      <p className="mt-1 text-xs text-text-muted">{status}</p>
      {plan.status === ACTION_STATUS.DRAFT && (
        <div className="mt-2">
          <ActionButtons actionId={plan.actionId} compact />
        </div>
      )}
    </section>
  );
}
