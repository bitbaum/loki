import { CreditCard, ExternalLink, Wallet } from "lucide-react";
import { format } from "date-fns";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { NewSubscriptionButton } from "@/components/money/NewSubscriptionButton";
import { SubscriptionsList, type SubscriptionView } from "@/components/money/SubscriptionsList";
import { SUB_STATUS } from "@/lib/constants/statuses";
import {
  getAllSubscriptions,
  getFinancialCommitments,
  calculateMonthlyBurn,
} from "@/db/queries/money";
import { requirePageUserId } from "@/lib/session";
import { getUserById } from "@/db/queries/users";
import { nextChargeDate, subscriptionDue } from "@/lib/subscription-due";
import { formatMoney } from "@/lib/format";
import { ORANGECAT_INTEGRATION as INTEGRATION } from "@/config/marketing-content";

export const metadata = { title: "Money" };

type Sub = Awaited<ReturnType<typeof getAllSubscriptions>>[number];

const toView = (s: Sub): SubscriptionView => ({
  id: s.id,
  name: s.name,
  vendor: s.vendor,
  amount: s.amount,
  currency: s.currency,
  frequency: s.frequency,
  status: s.status,
  nextDue: s.nextDue ? s.nextDue.toISOString() : null,
  notes: s.notes,
  paymentMethod: s.paymentMethod,
});

/** "A, B and C" */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export default async function MoneyPage() {
  const userId = await requirePageUserId();
  const [allSubs, commitments, viewer] = await Promise.all([
    getAllSubscriptions(userId),
    getFinancialCommitments(userId),
    getUserById(userId).catch(() => null),
  ]);

  const activeSubs = allSubs.filter((s) => s.status === SUB_STATUS.ACTIVE);
  const visibleSubs = allSubs.filter((s) => s.status !== SUB_STATUS.CANCELLED);
  const cancelledSubs = allSubs.filter((s) => s.status === SUB_STATUS.CANCELLED);
  const unverified = visibleSubs.filter((s) => s.status === SUB_STATUS.UNVERIFIED).length;
  const burn = calculateMonthlyBurn(activeSubs);
  // Each currency on its own: there is no exchange rate here to add francs to
  // dollars, so the sentence names each total rather than inventing a sum.
  const perCurrency = [
    burn.totalChf > 0 ? formatMoney(burn.totalChf, "CHF") : null,
    burn.totalUsd > 0 ? formatMoney(burn.totalUsd, "USD") : null,
    burn.totalEur > 0 ? formatMoney(burn.totalEur, "EUR") : null,
    burn.totalGbp > 0 ? formatMoney(burn.totalGbp, "GBP") : null,
  ].filter((x): x is string => !!x);
  const nextCharge =
    visibleSubs
      .map((s) => ({ name: s.name, date: nextChargeDate(subscriptionDue(s.nextDue, s.frequency)) }))
      .filter((s): s is { name: string; date: Date } => s.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;

  // The page's numbers as one sentence (design reset rule 7), not three tiles.
  const summary = [
    `${joinAnd(perCurrency.length > 0 ? perCurrency : [formatMoney(0, "CHF")])} a month across ${burn.count} ${burn.count === 1 ? "subscription" : "subscriptions"}.`,
    nextCharge ? `Next: ${nextCharge.name} on ${format(nextCharge.date, "d MMM")}.` : null,
    unverified > 0
      ? `${unverified} ${unverified === 1 ? "has" : "have"} no receipt behind ${unverified === 1 ? "it" : "them"} yet.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Company plumbing — the founder's own OrangeCat wallet and listing. Only
  // the founder may see it: it is not a fact about any other tenant's money.
  const isFounder = viewer?.isDefault === true;

  return (
    <PageLayout title="Money" maxWidth="max-w-2xl" action={<NewSubscriptionButton />}>
      {visibleSubs.length === 0 && cancelledSubs.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="What do you pay for every month?"
          action={<NewSubscriptionButton trigger="secondary" triggerLabel="Add the first one" />}
        />
      ) : (
        <>
          {visibleSubs.length > 0 && <p className="ui-life-summary">{summary}</p>}
          <SubscriptionsList subs={visibleSubs.map(toView)} cancelled={cancelledSubs.map(toView)} />
        </>
      )}

      {commitments.length > 0 && (
        <Section title="Money you've promised">
          <List aria-label="Financial commitments">
            {commitments.map((c) => (
              <ListRow
                key={c.id}
                href="/today"
                icon={Wallet}
                title={c.description}
                secondary={c.dueDate ? `Due ${format(c.dueDate, "d MMM")}` : "No date"}
                trailing={c.financialImpact}
              />
            ))}
          </List>
        </Section>
      )}

      {isFounder && (
        <Section title="OrangeCat">
          <List aria-label="OrangeCat">
            <ListRow
              href={INTEGRATION.orangeCat.profile}
              icon={ExternalLink}
              title={`${INTEGRATION.orangeCat.title} profile`}
              secondary={`Loki is a paying customer of ${INTEGRATION.orangeCat.title}`}
            />
            <ListRow
              icon={Wallet}
              title="Shared Bitcoin wallet"
              secondary={INTEGRATION.wallet.btc}
            />
          </List>
        </Section>
      )}
    </PageLayout>
  );
}
