import { listCaptures, countCaptures } from "@/db/queries/captures";
import { requirePageUserId } from "@/lib/session";
import { Section } from "@/components/ui/section-heading";
import { StickyNoteList } from "./StickyNoteList";

// The sticky note is where walk-mode thoughts land ("add X to my list" to
// Loki, or typed here) and where they get reviewed and checked off at the
// desk. Captures were write-only before this existed — a list you can add to
// but never see again is not a list. A section of rows, not a card (design
// reset, 2026-10).
export async function StickyNoteCard() {
  const userId = await requirePageUserId();
  const [items, total] = await Promise.all([listCaptures(userId, 20), countCaptures(userId)]);

  return (
    <div id="sticky-note" className="scroll-mt-20">
      <Section title={total > 0 ? `Sticky note · ${total}` : "Sticky note"}>
        <StickyNoteList
          initial={items.map((c) => ({ id: c.id, body: c.body }))}
          hiddenCount={Math.max(0, total - items.length)}
        />
      </Section>
    </div>
  );
}
