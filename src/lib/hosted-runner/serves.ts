import { getSelfImprovementTarget } from "@/db/queries/frontier";

/**
 * Whose work the hosted runner claims. `scripts/hosted-runner.ts` serves ONE
 * account — the owner of the `loki` entity — and nothing else drains a
 * `hosted_dispatch` row. Until 2026-10-20 "Hosted runner" was offered to
 * every account and accepted as a project's builder for anyone, so a tenant
 * who chose it queued work that nothing would ever claim, labelled "Queued
 * on hosted runner". The offer, the stored choice and the two dispatch
 * paths (inject-core.ts) all ask here first.
 */
export async function hostedRunnerServes(userId: string): Promise<boolean> {
  const target = await getSelfImprovementTarget().catch(() => null);
  return target?.userId === userId;
}
