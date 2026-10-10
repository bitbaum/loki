/**
 * Where a user connects, changes or removes their own model — Settings → AI.
 *
 * Its own module, with no imports, because the places that point people here
 * include the budget gate, which is loaded in the database-free test tier and
 * must not pull in the model plumbing to know a path.
 */
export const OWN_MODEL_SETTINGS_PATH = "/settings#ai";

/** The same place with one vendor's add form already open — the store's
 *  "Add" button; with `model`, that model already chosen. */
export function ownModelAddPath(vendor: string, model?: string): string {
  const q = new URLSearchParams({ add: vendor });
  if (model) q.set("model", model);
  return `/settings?${q.toString()}#ai`;
}

/** Where providers are compared and chosen. */
export const MODEL_STORE_PATH = "/models";
