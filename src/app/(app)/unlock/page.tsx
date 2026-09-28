import { redirect } from "next/navigation";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneConfigured, isPrivateZoneUnlocked } from "@/lib/private-zone";
import { getPrivateZoneStats } from "@/db/queries/private-zone-stats";
import { UnlockForm } from "@/components/private/UnlockForm";
import { PageLayout } from "@/components/ui/page-layout";

export const metadata = { title: "Unlock private zone" };

type SearchParams = Promise<{ next?: string }>;

export default async function UnlockPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requirePageUserId();
  const { next } = await searchParams;
  const nextHref = sanitizeNext(next);

  // No PIN set → guide the user to Settings → Privacy.
  if (!(await isPrivateZoneConfigured(userId))) {
    return (
      <PageLayout title="Private zone is open" maxWidth="max-w-xl">
        <div className="ui-settings-section">
          <p className="text-sm text-text-secondary">
            You haven&apos;t set a PIN yet, so the private zone is unlocked by default. Set one in
            Settings → Privacy to gate Memory, People, Robots, Goals, Habits, Events, and Money
            behind a PIN.
          </p>
          <a href="/settings#privacy" className="ui-btn-primary mt-2 inline-flex">
            Open Settings → Privacy
          </a>
        </div>
      </PageLayout>
    );
  }

  // Already unlocked → skip the form, go where the user was headed.
  if (await isPrivateZoneUnlocked(userId)) {
    redirect(nextHref);
  }

  // Concrete counts beat abstract descriptions — the user sees what unlocking
  // actually restores. Falls back to 0 if a count query fails so the page
  // still renders cleanly.
  const stats = await getPrivateZoneStats(userId).catch(() => ({
    memoryEntities: 0,
    people: 0,
    robots: 0,
    goals: 0,
    habits: 0,
    events: 0,
    subscriptions: 0,
    commitments: 0,
  }));

  const areas = [
    {
      label: "Memory",
      description: "Knowledge graph — people, projects, decisions, conversations.",
      count: stats.memoryEntities,
      unit: "entities",
    },
    {
      label: "People",
      description: "Your private address book. Other users have their own.",
      count: stats.people,
      unit: "contacts",
    },
    {
      label: "Robots",
      description: "Machines you own — profile, book, rent, or sell.",
      count: stats.robots,
      unit: "robots",
    },
    {
      label: "Goals",
      description: "Your personal goals. A project's roadmap always shows on its own page.",
      count: stats.goals,
      unit: "goals",
    },
    {
      label: "Habits",
      description: "Daily streaks and 30-day heatmaps.",
      count: stats.habits,
      unit: "habits",
    },
    {
      label: "Events",
      description: "Deadlines and opportunities.",
      count: stats.events,
      unit: "events",
    },
    {
      label: "Money",
      description: "Subscriptions and monthly burn.",
      count: stats.subscriptions,
      unit: "subscriptions",
    },
    {
      label: "Commitments",
      description: "Promises you have made and what they will cost.",
      count: stats.commitments,
      unit: "commitments",
    },
  ];

  return (
    <PageLayout title="Unlock private zone" maxWidth="max-w-xl">
      <UnlockForm next={nextHref} areas={areas} />
    </PageLayout>
  );
}

/**
 * Only allow same-origin destinations; reject anything starting with `//` or a
 * protocol so a crafted `?next=` cannot redirect the user off-site after a
 * successful unlock.
 */
function sanitizeNext(raw: string | undefined): string {
  if (!raw) return "/today";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/today";
  return raw;
}
