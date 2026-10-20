/**
 * The pure half of lib/studio/seat.ts: what changes between the seat a brief
 * implied and the seat it will imply. Kept apart so the unit suite can read it
 * without a database behind it.
 */
export type Seat = { projectId: string; userId: string };
export type SeatChange = { revoke: Seat | null; grant: Seat | null };
type SeatFacts = { projectId: string | null; builderUserId: string | null };

/** What changes between the seat the row implied and the seat it will imply. Pure. */
export function seatChange(prev: SeatFacts, next: SeatFacts): SeatChange | null {
  const before = prev.projectId && prev.builderUserId ? prev : null;
  const after = next.projectId && next.builderUserId ? next : null;
  const same =
    before?.projectId === after?.projectId && before?.builderUserId === after?.builderUserId;
  const revoke =
    before && !same ? { projectId: before.projectId!, userId: before.builderUserId! } : null;
  const grant =
    after && !same ? { projectId: after.projectId!, userId: after.builderUserId! } : null;
  return revoke || grant ? { revoke, grant } : null;
}
