import { removeProjectMember, upsertProjectMember } from "@/db/queries/project-access";
import { setPrivateBuilder } from "@/db/queries/users";

/**
 * A booked partner's seat (Track 3.2 of docs/master-plan-2026-10.md): the
 * assigned partner is an EDITOR on the brief's linked project and nothing
 * else — the unit of involvement is the project, never an org
 * (docs/architecture/builders-and-booking.md). The seat follows the two
 * facts it depends on, assignment and the project link, and goes when
 * either does; the private builder a seat switches on stays, because other
 * seats may rest on it and it costs nothing idle.
 */
export { seatChange, type Seat, type SeatChange } from "@/lib/studio/seat-change";
import type { SeatChange } from "@/lib/studio/seat-change";

/** Apply a change: the seat on the project, and the tenant the builder builds in. */
export async function applyBuilderSeat(change: SeatChange): Promise<void> {
  if (change.revoke) await removeProjectMember(change.revoke.projectId, change.revoke.userId);
  if (change.grant) {
    await upsertProjectMember(change.grant.projectId, change.grant.userId, "editor");
    await setPrivateBuilder(change.grant.userId, true);
  }
}
