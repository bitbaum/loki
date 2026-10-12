import { searchHits, type SearchSpec } from "@/lib/search";

/** The least a goal tree needs to be searched. */
type GoalNode<T> = { title: string; description: string | null; children: T[] };

const GOAL_SPEC: SearchSpec<GoalNode<unknown>> = {
  fields: [
    { name: "title", get: (g) => g.title },
    { name: "description", get: (g) => g.description },
  ],
};

/**
 * The goals a query reaches, as a tree: a goal stays when it or anything under
 * it matches, and keeps only the children that lead to a match. One slip in a
 * word still matches ("marathn"); the tree's own order is kept.
 */
export function filterGoalTree<T extends GoalNode<T>>(goals: T[], query: string): T[] {
  if (!query.trim()) return goals;
  const flat: T[] = [];
  const walk = (nodes: T[]) =>
    nodes.forEach((g) => {
      flat.push(g);
      walk(g.children);
    });
  walk(goals);
  const matched = new Set(searchHits(flat, GOAL_SPEC, query).map((hit) => hit.item));
  const prune = (nodes: T[]): T[] =>
    nodes.flatMap((g) => {
      const children = prune(g.children);
      return matched.has(g) || children.length > 0 ? [{ ...g, children }] : [];
    });
  return prune(goals);
}
