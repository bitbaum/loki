import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLayout } from "@/components/ui/page-layout";
import { ModelStore } from "@/components/models/ModelStore";
import { requirePageUserId } from "@/lib/session";
import { storeDataFor } from "@/lib/models/store-data";
import { NAV } from "@/config/navigation";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

export const metadata: Metadata = { title: NAV.models.label };

/**
 * The model landscape: every chat model in the catalogue, filterable and
 * rankable, with the ways to run each one through Loki and one tap to bring
 * a key — or to point Loki at a model on your own machine. Server-rendered
 * from the cached catalogue so the first paint carries the numbers; the
 * client takes over for filtering, sorting and the refresh.
 */
export default async function ModelsPage() {
  const userId = await requirePageUserId();
  const data = await storeDataFor(userId);
  return (
    <PageLayout
      title={NAV.models.label}
      // Opened from Settings → AI ("Compare providers and prices"): the way
      // back is drawn, not left to the bottom bar's "More" (2026-11-12).
      back={{ href: OWN_MODEL_SETTINGS_PATH, label: "AI settings" }}
      subtitle="Every model worth knowing, what it costs, and who you pay. Loki takes no cut."
      maxWidth="max-w-6xl"
    >
      <Suspense fallback={null}>
        <ModelStore initial={data} />
      </Suspense>
    </PageLayout>
  );
}
