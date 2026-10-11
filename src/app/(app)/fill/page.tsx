import { PageLayout } from "@/components/ui/page-layout";
import { Card } from "@/components/ui/card";
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
        <Card>
          <p className="text-sm md:text-base">This link doesn&apos;t name a form Loki knows.</p>
          <p className="text-xs md:text-sm text-text-secondary mt-1">
            Ask Loki again — for example &ldquo;set up npm trusted publishing for my package&rdquo;
            — and open the new link it gives you.
          </p>
        </Card>
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
