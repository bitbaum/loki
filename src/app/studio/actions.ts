"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, signIn } from "@/auth";
import { COMMISSION } from "@/config/commission";
import { getUserById } from "@/db/queries/users";
import { reopenStudioApplication } from "@/db/queries/studio-requests";
import { studioPortalUrl } from "@/lib/studio/link-mail";

/** Sign in (or link) with OrangeCat and come straight back to `to`. */
export async function continueWithOrangecat(to: string) {
  // Only Loki's own studio pages are valid destinations.
  const back = /^\/studio\/(connect\?token=[\w.%-]+|partner)$/.test(to) ? to : "/studio/partner";
  await signIn("orangecat", { redirectTo: back });
}

/** A connected partner reopens their application with a fresh private link. */
export async function reopenApplication(id: string) {
  if (!z.uuid().safeParse(id).success) redirect("/studio/partner");
  const session = await auth();
  const user = session?.user?.id ? await getUserById(session.user.id) : null;
  if (!user?.orangecatActorId) redirect("/studio/partner");
  const reopened = await reopenStudioApplication(id, user.orangecatActorId);
  redirect(
    reopened
      ? studioPortalUrl(reopened.id, reopened.accessKey)
      : `${COMMISSION.studioOrigin}/portal/`,
  );
}
