/**
 * When a Bitcoin pass bought on OrangeCat ends.
 *
 * The grant set "now + the pass's days", so a buyer who renewed before the
 * pass ran out lost the days they had left (package audit, 2026-11-12). A
 * pass is sold as days added to the end: @bitbaum/paykit's extendEntitlement
 * stacks from the later of the current end and the payment. Only the same
 * plan, still running, stacks; an upgrade or a lapsed pass starts at payment.
 */
import { extendEntitlement } from "@bitbaum/paykit/checkout";

export interface CurrentPass {
  plan: string | null;
  planExpiresAt: Date | null;
}

export function renewedPassExpiry(input: {
  current: CurrentPass | null;
  plan: string;
  periodDays: number;
  paidAt: Date;
}): Date {
  const { current, plan, periodDays, paidAt } = input;
  const running =
    current?.plan === plan && current.planExpiresAt && current.planExpiresAt > paidAt
      ? { planId: plan, expiresAt: current.planExpiresAt.toISOString() }
      : null;
  return new Date(extendEntitlement(running, { id: plan, days: periodDays }, paidAt).expiresAt);
}
