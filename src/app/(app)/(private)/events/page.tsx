import { getEvents, getArchivedEvents } from "@/db/queries/events";
import { requirePageUserId } from "@/lib/session";
import { EventsList } from "@/components/events/EventsList";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const userId = await requirePageUserId();
  const [items, archived] = await Promise.all([getEvents(userId), getArchivedEvents(userId)]);
  return <EventsList initialEvents={items} initialArchived={archived} />;
}
