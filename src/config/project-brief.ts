/**
 * How long "what do you want to build?" may be, in one place.
 *
 * It was three numbers. The homepage keeps a visitor's sentence up to 2000
 * characters (lib/first-words) and the new-project form accepted a prefilled
 * brief of 2000, but its text box said maxLength 300 and so did the route's
 * schema. A carried sentence of 356 characters sat in the box whole (a
 * prefilled value is never cut by maxLength), and Create answered "Invalid
 * body": the one path the homepage sends people down ended in a dead end.
 *
 * The brief is the project's own description and the first task's words. Only
 * the GitHub repository description is short, and that one is cut where it is
 * sent (repoDescription), not where the person types.
 */
export const PROJECT_BRIEF_MAX = 2000;

/** GitHub refuses a long repository description; 300 is well inside it. */
export const REPO_DESCRIPTION_MAX = 300;

/** The brief as a repository description: whole when it fits, otherwise cut
 *  at the last word that does, with an ellipsis. */
export function repoDescription(brief: string): string {
  const text = brief.replace(/\s+/g, " ").trim();
  if (text.length <= REPO_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, REPO_DESCRIPTION_MAX - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > REPO_DESCRIPTION_MAX * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}
