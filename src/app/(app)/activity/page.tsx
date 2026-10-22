import { ActivityView } from "@/components/activity/ActivityView";
import { requirePageUserId } from "@/lib/session";

export const metadata = { title: "Activity" };

/** ActivityView draws the page itself: its one action (the report) needs the window it covers. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; project?: string; density?: string; status?: string }>;
}) {
  const userId = await requirePageUserId();
  const params = await searchParams;

  return (
    <ActivityView
      userId={userId}
      window={params.window}
      project={params.project}
      status={params.status}
    />
  );
}
