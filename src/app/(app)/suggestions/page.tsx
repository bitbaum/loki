import { PageLayout } from "@/components/ui/page-layout";
import { SuggestionsBoard } from "@/components/suggestions/SuggestionsBoard";
import { NAV } from "@/config/navigation";
import { requirePageUserId } from "@/lib/session";

export const metadata = { title: NAV.suggestions.label };

/**
 * Every front of a person's life that Loki keeps records on, read into one
 * page of things to do next — build, business, goals, people, money, habits
 * (config/suggestion-avenues.ts). Each card names the fact it came from and
 * takes one tap: "Do it" hands it to Loki with the ask written, "Not now"
 * puts it away. The start screen and Control keep the short build row; this
 * is the whole board.
 */
export default async function SuggestionsPage() {
  await requirePageUserId();
  return (
    <PageLayout title={NAV.suggestions.label} maxWidth="max-w-2xl">
      <SuggestionsBoard />
    </PageLayout>
  );
}
