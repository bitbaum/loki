import { redirect } from "next/navigation";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneConfigured, isPrivateZoneUnlocked } from "@/lib/private-zone";
import { getPrivateZoneStats } from "@/db/queries/private-zone-stats";
import { UnlockForm } from "@/components/private/UnlockForm";
import { PageLayout } from "@/components/ui/page-layout";
import { PRIVATE_AREAS_PHRASE, PRIVATE_NAV_ITEMS } from "@/config/navigation";

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
            You haven&apos;t set a PIN yet, so the private zone is open. Set one in Settings →
            Privacy to keep {PRIVATE_AREAS_PHRASE} behind a PIN.
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

  // One row per private page, from the navigation SSOT — so this list and
  // Settings → Privacy name the same areas. Counts in plain nouns.
  const facts: Record<string, { description: string; count?: number; unit?: string }> = {
    memory: {
      description: "What Loki remembers about people, projects and decisions.",
      count: stats.memoryEntities,
      unit: "things",
    },
    people: {
      description: "Your private address book. Other people have their own.",
      count: stats.people,
      unit: "contacts",
    },
    crew: { description: "People you ask to do what an agent cannot." },
    robots: {
      description: "Machines you own.",
      count: stats.robots,
      unit: "robots",
    },
    goals: { description: "Your personal goals.", count: stats.goals, unit: "goals" },
    habits: { description: "Daily streaks.", count: stats.habits, unit: "habits" },
    events: { description: "Deadlines and opportunities.", count: stats.events, unit: "events" },
    money: {
      description: "Subscriptions, monthly spending and what you have promised to pay.",
      count: stats.subscriptions,
      unit: "subscriptions",
    },
  };
  const areas = PRIVATE_NAV_ITEMS.map((item) => ({
    label: item.label,
    ...(facts[item.id] ?? { description: item.description }),
  }));

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
