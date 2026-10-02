import { CreditCard, AlertCircle, HelpCircle, ExternalLink } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { StatRow } from "@/components/ui/stat-row";
import { SubscriptionActions } from "@/components/money/SubscriptionActions";
import { NewSubscriptionButton } from "@/components/money/NewSubscriptionButton";
import { CancelledSubsSection } from "@/components/money/CancelledSubsSection";
import { SUBSCRIPTION_META, FREQUENCY } from "@/config/subscriptions";
import { SUB_STATUS, type SubStatus } from "@/lib/constants/statuses";
import {
  getAllSubscriptions,
  getFinancialCommitments,
  calculateMonthlyBurn,
} from "@/db/queries/money";
import { requirePageUserId } from "@/lib/session";
import { getUserById } from "@/db/queries/users";
import { format } from "date-fns";
import { nextChargeDate, subscriptionDue } from "@/lib/subscription-due";
import { formatMoney } from "@/lib/format";
import { ORANGECAT_INTEGRATION as INTEGRATION } from "@/config/marketing-content";

export const metadata = { title: "Money" };

const STATUS_STYLE: Record<SubStatus, string> = {
  [SUB_STATUS.ACTIVE]: "text-status-positive bg-status-positive-subtle",
  [SUB_STATUS.UNVERIFIED]: "text-status-warning bg-status-warning-subtle",
  [SUB_STATUS.CANCELLED]: "text-text-tertiary bg-surface-overlay",
};

function SubRow({ sub }: { sub: Awaited<ReturnType<typeof getAllSubscriptions>>[number] }) {
  const verifyUrl = SUBSCRIPTION_META[sub.name]?.verifyUrl;
  const statusStyle =
    STATUS_STYLE[sub.status ?? SUB_STATUS.ACTIVE] ?? STATUS_STYLE[SUB_STATUS.ACTIVE];
  const isCancelled = sub.status === SUB_STATUS.CANCELLED;
  // A past stored date on a recurring charge means it renewed, not that it is
  // owed — every active row used to read "Overdue <months ago>" in red.
  const due = subscriptionDue(sub.nextDue, sub.frequency, { cancelled: isCancelled });

  return (
    <div className={`flex items-center justify-between py-1 ${isCancelled ? "opacity-40" : ""}`}>
      <div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusStyle}`}>
            {sub.status}
          </span>
          <span className={`text-sm md:text-base font-medium ${isCancelled ? "line-through" : ""}`}>
            {sub.name}
          </span>
          {verifyUrl && (
            <a
              href={verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-text-muted transition-colors hover:text-text-primary"
              title={`Verify at ${new URL(verifyUrl).hostname}`}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {sub.orangecatServiceId && (
            <span
              className="text-micro px-1.5 py-0.5 rounded font-medium bg-status-positive/10 text-status-positive"
              title={`Synced to OrangeCat service ${sub.orangecatServiceId}`}
            >
              OC ✓
            </span>
          )}
        </div>
        <div className="text-sm text-text-secondary">
          {sub.vendor}
          {sub.paymentMethod ? ` · ${sub.paymentMethod}` : ""}
          {sub.frequency !== FREQUENCY.MONTHLY ? ` · ${sub.frequency}` : ""}
        </div>
        {/* Notes are a scratchpad — some run to several sentences of cancellation
            history — and rendering them in full turned each row into a
            paragraph, burying the amount the page exists to show. Two lines is
            enough to recognise which note this is; Edit opens the whole thing.
            No `block` here: a display utility beats -webkit-line-clamp and
            silently makes the clamp inert (caught behaviourally by
            audit:responsive). */}
        {sub.notes && (
          <div className="mt-1 line-clamp-2 max-w-md text-sm text-text-tertiary" title={sub.notes}>
            {sub.notes}
          </div>
        )}
        <SubscriptionActions
          subId={sub.id}
          subName={sub.name}
          status={sub.status}
          nextDue={sub.nextDue ? sub.nextDue.toISOString() : null}
          frequency={sub.frequency}
          amount={sub.amount}
          currency={sub.currency}
          notes={sub.notes}
          paymentMethod={sub.paymentMethod}
          vendor={sub.vendor}
        />
      </div>
      <div className="text-right shrink-0">
        <div className={`text-base font-mono ${isCancelled ? "line-through" : ""}`}>
          {sub.amount != null ? (
            `${sub.amount} ${sub.currency}`
          ) : (
            <span className="text-text-tertiary">— {sub.currency}</span>
          )}
        </div>
        {due.kind === "due" && (
          <div className="text-sm text-text-secondary">Next {format(due.date, "d MMM")}</div>
        )}
        {due.kind === "charged" && (
          <div className="text-sm text-text-tertiary">Charged {format(due.date, "d MMM")}</div>
        )}
      </div>
    </div>
  );
}

export default async function MoneyPage() {
  const userId = await requirePageUserId();

  // OrangeCat integration banner — company-level plumbing (a wallet BTC
  // address, the internal stakeholder_relationships wiring between Loki
  // and OrangeCat), not a fact about the signed-in user's own subscriptions.
  //
  // Two bugs, not one. It rendered ABOVE the burn total and the subscription
  // list — the one thing every visitor to /money actually came here for — so
  // "irrelevant content first" was the mildest problem. The banner is built
  // from static config (ORANGECAT_INTEGRATION), not scoped by userId at all,
  // so it rendered identically for every signed-in tenant: any user on this
  // multi-user SaaS could open /money and read the founder's own wallet
  // address. RevenueCard on /system already treats "founder-only" as a real
  // gate (isDefault, "a regular tenant must never see fleet-wide MRR") —
  // this is the same class of fact and gets the same gate, not just a reorder.
  const viewer = await getUserById(userId).catch(() => null);
  const isFounder = viewer?.isDefault === true;
  const IntegrationBanner = isFounder ? (
    <div className="mt-6 p-3 bg-surface-raised border border-border-subtle rounded-lg text-sm">
      <div className="font-medium">
        Economic layer:{" "}
        <a href={INTEGRATION.orangeCat.profile} target="_blank" className="ui-link">
          {INTEGRATION.orangeCat.title} profile ({INTEGRATION.owner})
        </a>
      </div>
      {/* break-words: a bech32 address has no break opportunity, so it ran off
          the right edge of a 320px phone. */}
      {/* Named the database table this relationship is stored in
          (`stakeholder_relationships`) and then printed a bech32 string with
          no label — a sentence that is half schema and half unexplained
          hex. Founder-only or not, it should read like a note, not a dump. */}
      <div className="mt-1 break-words text-text-secondary">
        Loki is a paying customer of OrangeCat.{" "}
        <a href={INTEGRATION.orangeCat.projectUrl} target="_blank" className="ui-link">
          {INTEGRATION.orangeCat.title} project
        </a>{" "}
        ·{" "}
        <a href={INTEGRATION.loki.projectUrl} target="_blank" className="ui-link">
          {INTEGRATION.loki.title} project
        </a>
        .
      </div>
      <div className="mt-1 text-text-tertiary">
        Shared BTC wallet <code className="break-all">{INTEGRATION.wallet.btc}</code>
      </div>
    </div>
  ) : null;

  const [allSubs, commitments] = await Promise.all([
    getAllSubscriptions(userId),
    getFinancialCommitments(userId),
  ]);
  const activeSubs = allSubs.filter((s) => s.status === SUB_STATUS.ACTIVE);
  const burn = calculateMonthlyBurn(activeSubs);
  const visibleSubs = allSubs.filter((s) => s.status !== SUB_STATUS.CANCELLED);
  const cancelledSubs = allSubs.filter((s) => s.status === SUB_STATUS.CANCELLED);
  const unverifiedCount = visibleSubs.filter((s) => s.status === SUB_STATUS.UNVERIFIED).length;
  const burnByCurrency = [
    burn.totalChf > 0 ? formatMoney(burn.totalChf, "CHF") : null,
    burn.totalUsd > 0 ? formatMoney(burn.totalUsd, "USD") : null,
    burn.totalEur > 0 ? formatMoney(burn.totalEur, "EUR") : null,
    burn.totalGbp > 0 ? formatMoney(burn.totalGbp, "GBP") : null,
  ].filter(Boolean) as string[];
  // The soonest charge still ahead of us — what a person opens a money page to
  // find out. Read through the same rule as the rows, so a subscription whose
  // stored date has passed counts by the charge it renews on.
  const nextCharge =
    visibleSubs
      .map((s) => ({ name: s.name, date: nextChargeDate(subscriptionDue(s.nextDue, s.frequency)) }))
      .filter((s): s is { name: string; date: Date } => s.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;

  return (
    // The header action is suppressed while the list is empty: the empty state
    // already carries an "Add" button, and two identical buttons a thumb-width
    // apart is a choice the reader has to think about for no reason.
    <PageLayout
      title="Money"
      right={visibleSubs.length > 0 ? <NewSubscriptionButton /> : undefined}
    >
      {/* The summary is about the subscriptions, so with none there is nothing
          to summarise. It used to render regardless: "— / 0 active
          subscriptions", "0 / all confirmed", "— / other currencies" — three
          tiles and a third of a phone screen spent saying "nothing here",
          above an empty list with no way in. */}
      {visibleSubs.length > 0 && (
        <StatRow>
          {/* Stacked, not joined with " + ". Two currencies rendered as
              "50.00 CHF + 329.60 USD" wrapped mid-figure on a 390px phone, and
              the plus sign claimed a sum that does not exist — you cannot add
              francs to dollars without a rate this page does not have. One
              line per currency says the true thing and fits. */}
          <StatCard
            label="Monthly burn"
            value={
              burnByCurrency.length > 0 ? (
                <span className="flex flex-col leading-tight">
                  {burnByCurrency.map((amount) => (
                    <span key={amount}>{amount}</span>
                  ))}
                </span>
              ) : (
                formatMoney(0, "CHF")
              )
            }
            sub={`across ${burn.count} active ${burn.count === 1 ? "subscription" : "subscriptions"}`}
          />
          <StatCard
            label="Next charge"
            value={nextCharge ? format(nextCharge.date, "d MMM") : "—"}
            sub={nextCharge ? nextCharge.name : "no due dates set"}
          />
          {/* "Non-CHF /mo" was the third tile, and it printed the very same
              USD/EUR/GBP figures the burn tile already joins — the same money
              twice, under a label that reads like a different number. What is
              actually missing from the burn line is when the next one lands,
              which is the reason to open a money page in the first place. */}
          <StatCard
            label="Unverified"
            value={String(unverifiedCount)}
            sub={unverifiedCount > 0 ? "no billing email found" : "all confirmed"}
          />
        </StatRow>
      )}

      <Card>
        <CardHeader
          icon={CreditCard}
          title="Subscriptions"
          right={
            visibleSubs.length > 0 ? (
              <span className="text-sm text-text-tertiary">Verified against email receipts</span>
            ) : undefined
          }
        />
        {visibleSubs.length > 0 ? (
          <div className="space-y-3">
            {visibleSubs.map((sub) => (
              <SubRow key={sub.id} sub={sub} />
            ))}
          </div>
        ) : (
          <div className="ui-empty-block ui-empty-block-md">
            <CreditCard className="ui-empty-icon" aria-hidden="true" />
            <p className="ui-empty-title">No subscriptions tracked yet</p>
            <p className="ui-empty-helper">
              Add what you pay for each month and this page totals the burn, flags anything with no
              billing email behind it, and tells you what is due next.
            </p>
            <NewSubscriptionButton />
          </div>
        )}
        <CancelledSubsSection count={cancelledSubs.length}>
          {cancelledSubs.map((sub) => (
            <SubRow key={sub.id} sub={sub} />
          ))}
        </CancelledSubsSection>
        {/* The footnote explains the arrow icon on a row and what "unverified"
            means on a chip. With no rows there is neither, so it explained a UI
            that was not on the screen. */}
        {visibleSubs.length > 0 && (
          <div className="mt-5 flex items-start gap-2 border-t border-border-subtle pt-4 text-sm text-text-tertiary">
            <HelpCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>
              Tap the arrow on a row to verify at the source. Unverified = no billing email found.
              Ask Loki to re-scan if something looks wrong.
            </span>
          </div>
        )}
      </Card>

      {commitments.length > 0 && (
        <Card>
          <CardHeader icon={AlertCircle} title="Financial Commitments" />
          <div className="space-y-2">
            {commitments.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-1">
                <div className="text-base text-text-primary">{c.description}</div>
                <div className="text-base font-mono text-status-warning">{c.financialImpact}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {IntegrationBanner}
    </PageLayout>
  );
}
