import type { Metadata } from "next";
import { PageLayout } from "@/components/ui/page-layout";
import { ModelStore, type ModelStoreData } from "@/components/models/ModelStore";
import { requirePageUserId } from "@/lib/session";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { fetchStoreCatalog } from "@/lib/models/store-catalog";
import { MODEL_STORE_VENDORS } from "@/config/model-store";

export const metadata: Metadata = { title: "Models" };

/**
 * The model store: who can think for you, what each costs, and one tap to
 * bring your key. Server-rendered from the cached catalogue so the first
 * paint carries prices; the client takes over for sorting and the refresh.
 */
export default async function ModelsPage() {
  const userId = await requirePageUserId();
  const [catalog, own] = await Promise.all([
    fetchStoreCatalog(),
    listOwnModels(userId).catch(() => []),
  ]);
  const connected = new Map(own.map((m) => [m.vendor, m]));
  const data: ModelStoreData = {
    fetchedAt: catalog?.fetchedAt ?? null,
    vendors: MODEL_STORE_VENDORS.map((v) => {
      const live = catalog?.vendors.find((c) => c.id === v.id);
      const mine = connected.get(v.id);
      return {
        ...v,
        namespaces: [...v.namespaces],
        connected: mine ? { model: mine.model, startsHere: own[0]?.vendor === v.id } : null,
        featured: live?.featured ?? [],
        all: live?.all ?? [],
        recentCount: live?.recentCount ?? 0,
      };
    }),
  };
  return (
    <PageLayout
      title="Models"
      subtitle="Who thinks for you, and who you pay. Loki takes no cut."
      maxWidth="max-w-5xl"
    >
      <ModelStore initial={data} />
    </PageLayout>
  );
}
