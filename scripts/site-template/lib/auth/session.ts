import { headers } from "next/headers";
import { authStatus, getAuth } from "./server";

/**
 * Who is signed in, for a server component or route. Null when nobody is, and
 * also when accounts are unavailable on this deployment — a page asking "who
 * is this" must never crash because the database is down.
 */
export async function getSession() {
  if (!authStatus().ready) return null;
  try {
    return await getAuth().api.getSession({ headers: await headers() });
  } catch (error) {
    console.error(`[auth] session read failed: ${(error as Error).name}`);
    return null;
  }
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
