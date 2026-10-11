/**
 * Pins which token an org-scoped GitHub write uses, and who may use the
 * server's org token.
 * Run: npx tsx scripts/test/github-org-token.ts
 */
import { lokiKeepsCode, mayUseOrgToken, pickRepoWriteToken } from "@/lib/github-org-token";

const org = pickRepoWriteToken("org-tok", "user-tok");
if (!org || org.source !== "org" || org.token !== "org-tok") {
  throw new Error("a configured org token must win over the person's token");
}
const user = pickRepoWriteToken(null, "user-tok");
if (!user || user.source !== "user" || user.token !== "user-tok") {
  throw new Error("without an org token the person's token is used");
}
if (pickRepoWriteToken(null, null) !== null) throw new Error("no token → null, never a guess");
if (pickRepoWriteToken("", "user-tok")?.source !== "user") {
  throw new Error("an empty org token is no org token");
}

// Who may use the org token. Entitled accounts always; anyone for code Loki
// keeps; nobody else on anything else — that last line is the one that keeps
// "Loki keeps your code" from being a credential aimed at the org.
if (!mayUseOrgToken(true)) throw new Error("an entitled account may always use the org token");
if (!mayUseOrgToken(false, { lokiKept: true })) {
  throw new Error("creating or acting on code Loki keeps needs no GitHub account at all");
}
if (mayUseOrgToken(false)) {
  throw new Error("an unentitled account gets the org token for nothing but Loki-kept code");
}
if (mayUseOrgToken(false, { lokiKept: false })) {
  throw new Error("explicitly not Loki-kept is the same as not saying so");
}

// What counts as code Loki keeps: a project with no repository yet (the one
// about to be created is Loki's), or one whose custody says so. A linked
// repository with no custody recorded is the person's own — it was linked by
// hand, and nothing proves Loki made it.
if (!lokiKeepsCode(null)) throw new Error("no project row yet → the repo to create is Loki's");
if (!lokiKeepsCode({ gitUrl: null })) throw new Error("no repository yet → Loki's to create");
if (!lokiKeepsCode({ gitUrl: "https://github.com/bitbaum/x", codeCustody: "loki" })) {
  throw new Error("custody loki → Loki keeps it");
}
if (lokiKeepsCode({ gitUrl: "https://github.com/bitbaum/orangecat", codeCustody: null })) {
  throw new Error("a linked repo with no custody is the person's — never the org token");
}
if (lokiKeepsCode({ gitUrl: "https://github.com/me/x", codeCustody: "own" })) {
  throw new Error("custody own → the person's token only");
}

console.log("✓ github org token");
