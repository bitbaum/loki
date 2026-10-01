import { ChevronDown, Lightbulb } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listOpenProposals } from "@/db/queries/frontier";
import { ProposalRow } from "./ProposalRow";

/** How many proposals show before the rest fold behind one "show more". */
const VISIBLE_PROPOSALS = 5;

/**
 * The self-improvement inbox. The daily frontier loop drafts proposals for how
 * Loki should evolve, critiques them, and surfaces only those that clear
 * the bar here. The owner accepts (→ a roadmap goal) or dismisses; the loop
 * never builds on its own. Server-read — re-renders on page revalidation.
 *
 * It sits at the bottom of /system: it is a reading queue, not machine health,
 * and fully expanded it was over half the page on a phone. Rows are one line
 * each; the first few show, the rest fold behind one disclosure.
 */
export async function FrontierProposalsCard({ userId }: { userId: string }) {
  const proposals = await listOpenProposals(userId).catch(() => []);
  const visible = proposals.slice(0, VISIBLE_PROPOSALS);
  const folded = proposals.slice(VISIBLE_PROPOSALS);
  const right =
    proposals.length > 0 ? (
      <span className="text-xs font-medium text-accent-text">{proposals.length} to review</span>
    ) : (
      <span className="text-xs text-text-tertiary">nothing pending</span>
    );

  return (
    <Card>
      <CardHeader icon={Lightbulb} title="Frontier proposals" right={right} />
      {proposals.length === 0 ? (
        <EmptyState>
          The fleet hasn&apos;t drafted new directions since you last reviewed. It mines each
          day&apos;s frontier digest for self-improvement ideas.
        </EmptyState>
      ) : (
        <>
          <p className="ui-proposal-lede">
            Ideas the fleet drafted for improving Loki. Open one to read it, then accept it as a
            goal or dismiss it. Nothing is built until you accept.
          </p>
          <ul className="ui-proposal-list">
            {visible.map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
          </ul>
          {folded.length > 0 && (
            <details className="mt-1">
              <summary className="ui-disclosure-summary">
                Show {folded.length} more
                <ChevronDown className="ui-disclosure-chevron" aria-hidden />
              </summary>
              <ul className="ui-proposal-list">
                {folded.map((p) => (
                  <ProposalRow key={p.id} proposal={p} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
