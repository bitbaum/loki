import { searchPeople, SORT_MODE } from "@/db/queries/people";
import { PeopleList } from "@/components/people/PeopleList";
import { RELATIONSHIP_HEALTH_VALUES, type RelationshipHealth } from "@/lib/constants/people";
import { requirePageUserId } from "@/lib/session";
import { isSiteOperator } from "@/db/queries/users";

export const metadata = { title: "People" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ health?: string }>;
}) {
  const params = await searchParams;
  // ?health=stale (a link from Today or Loki). One state at a time now — the
  // first one named — since "Show" is a single choice.
  const health =
    (params.health
      ?.split(",")
      .find((v) => RELATIONSHIP_HEALTH_VALUES.includes(v as RelationshipHealth)) as
      RelationshipHealth | undefined) ?? null;

  const userId = await requirePageUserId();
  const [{ people, total }, operator] = await Promise.all([
    searchPeople(userId, "", 50, 0, SORT_MODE.RECENT, health ? [health] : []),
    isSiteOperator(userId).catch(() => false),
  ]);

  return (
    <PeopleList
      initialPeople={people}
      initialTotal={total}
      initialHealth={health}
      openClaw={operator}
    />
  );
}
