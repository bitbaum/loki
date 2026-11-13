import { PageLayout } from "@/components/ui/page-layout";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { requirePageUserId } from "@/lib/session";
import { resolveBrowserTask, type BrowserRecipeId } from "@/config/browser-tasks";
import { FillHandoff } from "@/components/fill/FillHandoff";

export const metadata = { title: "Fill a form" };

/**
 * Where every form hand-off starts (config/browser-tasks.ts). Loki's chat and
 * MCP tool link here instead of listing fields to type. The page shows what
 * will be filled, then hands it to whatever this device has: the Loki
 * extension in Firefox (phones included), Fleet Runner's window on a computer,
 * or — with neither — the computer, plus every value one tap from the
 * clipboard so it is quick by hand too. No dead end on any device.
 */
export default async function FillPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUserId();
  const raw = await searchParams;
  const { recipe, ...rest } = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;
  const params = Object.fromEntries(
    Object.entries(rest).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const task = resolveBrowserTask(recipe, params);

  if (!task) {
    return (
      <PageLayout title="Fill a form" subtitle="Loki fills it and stops at the final button">
        {/* It said "ask Loki again" with no way to (2026-11-12). */}
        <EmptyState
          title="This link doesn't name a form Loki knows"
          action={
            <Link href="/loki" className="ui-btn-primary inline-flex min-h-11 items-center px-4">
              Ask Loki to fill a form
            </Link>
          }
        >
          Tell Loki which form, for example &ldquo;publish my package on npm&rdquo;, and open the
          new link it gives you.
        </EmptyState>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={task.title}
      subtitle={`On ${task.host} · you press “${task.handoff.button}”`}
    >
      <FillHandoff recipe={recipe as BrowserRecipeId} params={params} task={task} />
    </PageLayout>
  );
}
