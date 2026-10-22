import { notFound } from "next/navigation";
import { requirePageUserId } from "@/lib/session";
import { getPersonDetail } from "@/db/queries/people";
import { PersonDetail } from "@/components/people/PersonDetail";

export const metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
  const person = await getPersonDetail(userId, id);
  if (!person) notFound();

  // Handed over whole, so the page opens with the person on it — it used to
  // open on a skeleton and fetch the same row again from the browser.
  return (
    <PersonDetail
      person={{
        id: person.id,
        name: person.name,
        type: person.type,
        externalId: person.externalId,
        description: person.description,
        attrs: person.attrs,
        relations: person.relations,
        interactions: person.interactions.map((i) => ({
          channel: i.channel,
          direction: i.direction,
          summary: i.summary,
          occurredAt: i.occurredAt.toISOString(),
        })),
      }}
    />
  );
}
