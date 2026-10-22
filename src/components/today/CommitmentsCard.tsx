import { getActiveCommitments } from "@/db/queries/today";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { Section } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { CommitmentItem } from "./CommitmentItem";
import { AddCommitmentButton } from "./AddCommitmentButton";

/**
 * What you promised, as rows (design reset, 2026-10). It was a card headed
 * "Commitments · N active" with a three-line empty state inside it.
 */
export async function CommitmentsCard() {
  const userId = await requirePageUserId();
  // Commitments are personal life management — gated alongside the rest of
  // the private zone (money / habits / events / people).
  if (await isPrivateZoneLocked(userId)) {
    return null;
  }
  const items = await getActiveCommitments(userId);

  return (
    <div id="commitments" className="scroll-mt-24">
      <Section title="Commitments">
        {items.length === 0 ? (
          <EmptyState>Nothing promised right now.</EmptyState>
        ) : (
          <div className="ui-today-rows">
            {items.map((item) => (
              <CommitmentItem
                key={item.id}
                id={item.id}
                description={item.description}
                dueDate={item.dueDate}
                financialImpact={item.financialImpact}
              />
            ))}
          </div>
        )}
        <AddCommitmentButton />
      </Section>
    </div>
  );
}
