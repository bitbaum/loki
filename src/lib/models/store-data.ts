import { listOwnModels } from "@/db/queries/user-model-keys";
import { fetchStoreCatalog, type StoreLab, type StoreModel } from "@/lib/models/store-catalog";
import type { VendorId } from "@/config/model-vendors";

/**
 * What the store page and its refresh route both send: the catalogue, and
 * which keys this person holds. One builder, so the first paint and the
 * "Check for new models" answer cannot drift into two shapes.
 */
export type StoreConnection = { vendor: VendorId; model: string; label: string | null };

export type ModelStoreData = {
  fetchedAt: number | null;
  models: StoreModel[];
  labs: StoreLab[];
  connected: StoreConnection[];
};

export async function storeDataFor(userId: string, refresh = false): Promise<ModelStoreData> {
  const [catalog, own] = await Promise.all([
    fetchStoreCatalog({ refresh }),
    listOwnModels(userId).catch(() => []),
  ]);
  return {
    fetchedAt: catalog?.fetchedAt ?? null,
    models: catalog?.models ?? [],
    labs: catalog?.labs ?? [],
    connected: own.map((m) => ({ vendor: m.vendor, model: m.model, label: m.label })),
  };
}
