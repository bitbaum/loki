import { redirect } from "next/navigation";
import { getUserCount } from "@/db/queries/users";
import { setupRedirectFor } from "@/lib/setup-gate";
import { SetupForm } from "./SetupForm";

// Depends on the live user count, never on build-time state.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const to = setupRedirectFor(await getUserCount());
  if (to) redirect(to);
  return <SetupForm />;
}
