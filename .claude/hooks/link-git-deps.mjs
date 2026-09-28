// Used by session-start.sh on Claude Code on the web only. See that file.
//
// `list`: print name|owner/repo|sha for every `github:` dependency, the sha
//         taken from the lockfile (the commit pnpm actually pinned).
// `link <name> <dir>`: point package.json and pnpm-lock.yaml at a local clone
//         for this session's install. The originals are restored by the hook.
import { readFileSync, writeFileSync } from "node:fs";

const [mode, name, dir] = process.argv.slice(2);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lockPath = "pnpm-lock.yaml";

if (mode === "list") {
  const lock = readFileSync(lockPath, "utf8");
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [dep, spec] of Object.entries(deps)) {
    const m = /^github:([^#]+)/.exec(String(spec));
    if (!m) continue;
    const sha = new RegExp(`codeload\\.github\\.com/${m[1]}/tar\\.gz/([0-9a-f]{40})`).exec(lock);
    if (sha) console.log(`${dep}|${m[1]}|${sha[1]}`);
  }
} else if (mode === "link") {
  for (const k of ["dependencies", "devDependencies"]) {
    if (pkg[k]?.[name]) pkg[k][name] = `file:${dir}`;
  }
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let lock = readFileSync(lockPath, "utf8");
  // importer entry: `      name:` or `      'name':`, then specifier + version lines
  lock = lock.replace(
    new RegExp(`\\n {6}'?${esc(name)}'?:\\n {8}specifier: [^\\n]*\\n {8}version: [^\\n]*`),
    "",
  );
  // packages + snapshots entries keyed by the codeload url (quoted or not)
  lock = lock.replace(
    new RegExp(`\\n {2}'?${esc(name)}@https://codeload[^\\n]*\\n(?: {4}[^\\n]*\\n)+`, "g"),
    "\n",
  );
  writeFileSync(lockPath, lock);
} else {
  console.error("usage: link-git-deps.mjs list | link <name> <dir>");
  process.exit(2);
}
