import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { reservablePlan } from "@/lib/plan-reservation";
import {
  cancelPlanReservation,
  getPlanReservation,
  reservePlan,
} from "@/db/queries/plan-reservations";

/**
 * Reserve a paid plan while payments are not open — or take the reservation
 * back. Charges nothing and grants nothing (see db/schema/plan-reservations.ts).
 */
const Body = z.object({ plan: z.string().max(20) });

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const reservation = await getPlanReservation(userId);
  return jsonOk({ reservation });
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const plan = reservablePlan(body.plan);
  if (!plan) return jsonError("That plan cannot be reserved.", 400);
  const reservation = await reservePlan(userId, plan);
  return jsonOk({ reservation });
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  await cancelPlanReservation(userId);
  return jsonOk();
}
