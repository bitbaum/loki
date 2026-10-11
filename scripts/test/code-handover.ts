/**
 * The address a repository has once GitHub has moved it to the person.
 * Run: npx tsx scripts/test/code-handover.ts
 */
import { repoUrlAfterTransfer } from "@/lib/github-provision";

if (
  repoUrlAfterTransfer("https://github.com/bitbaum/zeitkastli", "anna") !==
  "https://github.com/anna/zeitkastli"
) {
  throw new Error("the repository keeps its name and takes the person's login as owner");
}
if (
  repoUrlAfterTransfer("https://github.com/bitbaum/zeitkastli.git", "anna") !==
  "https://github.com/anna/zeitkastli"
) {
  throw new Error("a .git suffix is not part of the name");
}
if (repoUrlAfterTransfer("not a url", "anna") !== null) {
  throw new Error("an address that is not a GitHub repository yields nothing, never a guess");
}
console.log("✓ code handover");
