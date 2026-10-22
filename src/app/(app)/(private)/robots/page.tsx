import { searchRobots } from "@/db/queries/robots";
import { RobotsList } from "@/components/robots/RobotsList";
import { requirePageUserId } from "@/lib/session";

export const metadata = { title: "Robots" };

export default async function RobotsPage() {
  const userId = await requirePageUserId();
  const { robots, total } = await searchRobots(userId, "", 100, 0);
  return <RobotsList initialRobots={robots} initialTotal={total} />;
}
