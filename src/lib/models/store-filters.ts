import { valueScore, type StoreModel } from "@/lib/models/store-catalog";

/**
 * The store's filters and sorts — pure, and spelled the same in the URL, the
 * toolbar and the table, so a filtered view is a link a person can send.
 *
 * Every sort puts the models it cannot rank LAST, never out: an unrated model
 * is still a model, and hiding it would make "smartest" quietly mean "rated".
 */
export type StoreSort = "value" | "smart" | "cheap" | "new" | "context";

export type StoreFilters = {
  q: string;
  open: boolean;
  free: boolean;
  vision: boolean;
  reasoning: boolean;
  /** Only models reachable on a key the person holds. */
  mine: boolean;
  lab: string | null;
  /** Max USD per million output tokens, or null. */
  max: number | null;
  sort: StoreSort;
};

export const DEFAULT_FILTERS: StoreFilters = {
  q: "",
  open: false,
  free: false,
  vision: false,
  reasoning: false,
  mine: false,
  lab: null,
  max: null,
  sort: "value",
};

export const STORE_SORTS: ReadonlyArray<{ id: StoreSort; label: string; explains: string }> = [
  { id: "value", label: "Best value", explains: "intelligence per dollar" },
  { id: "smart", label: "Smartest", explains: "Artificial Analysis intelligence index" },
  { id: "cheap", label: "Cheapest", explains: "price per million output tokens" },
  { id: "new", label: "Newest", explains: "when the lab listed it" },
  { id: "context", label: "Longest context", explains: "tokens it reads in one go" },
];

export const PRICE_CEILINGS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "under $1 / M out" },
  { value: 3, label: "under $3 / M out" },
  { value: 10, label: "under $10 / M out" },
];

const SORT_IDS = new Set<string>(STORE_SORTS.map((s) => s.id));

/** `?q=&open=1&lab=qwen&max=3&sort=smart` → filters. Unknown values fall to the default. */
export function parseFilters(params: URLSearchParams): StoreFilters {
  const flag = (k: string) => params.get(k) === "1";
  const max = Number(params.get("max"));
  const sort = params.get("sort") ?? "";
  return {
    q: (params.get("q") ?? "").slice(0, 80),
    open: flag("open"),
    free: flag("free"),
    vision: flag("vision"),
    reasoning: flag("reasoning"),
    mine: flag("mine"),
    lab: params.get("lab") || null,
    max: Number.isFinite(max) && max > 0 ? max : null,
    sort: SORT_IDS.has(sort) ? (sort as StoreSort) : DEFAULT_FILTERS.sort,
  };
}

/** Filters → the query string, omitting defaults so a plain /models stays plain. */
export function serializeFilters(f: StoreFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const k of ["open", "free", "vision", "reasoning", "mine"] as const) {
    if (f[k]) p.set(k, "1");
  }
  if (f.lab) p.set("lab", f.lab);
  if (f.max !== null) p.set("max", String(f.max));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  return p.toString();
}

export function applyFilters(
  models: readonly StoreModel[],
  f: StoreFilters,
  reachable: (m: StoreModel) => boolean,
): StoreModel[] {
  const q = f.q.trim().toLowerCase();
  return models.filter((m) => {
    if (q && !`${m.name} ${m.id} ${m.labLabel}`.toLowerCase().includes(q)) return false;
    if (f.open && !m.open) return false;
    if (f.free && !(m.free || m.freeVariant)) return false;
    if (f.vision && !m.vision) return false;
    if (f.reasoning && !m.reasoning) return false;
    if (f.mine && !reachable(m)) return false;
    if (f.lab && m.lab !== f.lab) return false;
    if (f.max !== null && (m.outPerM === null || m.outPerM > f.max)) return false;
    return true;
  });
}

const last = (v: number | null) => (v === null ? Number.NEGATIVE_INFINITY : v);

export function sortModels(models: readonly StoreModel[], sort: StoreSort): StoreModel[] {
  const keys: Record<StoreSort, (m: StoreModel) => number> = {
    value: (m) => last(valueScore(m)),
    smart: (m) => last(m.index),
    cheap: (m) => (m.outPerM === null ? Number.NEGATIVE_INFINITY : -m.outPerM),
    new: (m) => last(m.released),
    context: (m) => last(m.context),
  };
  const key = keys[sort];
  return [...models].sort(
    (a, b) => key(b) - key(a) || last(b.index) - last(a.index) || a.name.localeCompare(b.name),
  );
}
