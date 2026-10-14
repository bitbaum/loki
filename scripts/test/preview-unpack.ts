// Bringing a finished site into a preview folder from a zip: what is kept,
// what is refused. Needs python3 (as does the box). Run: npx tsx scripts/test/preview-unpack.ts
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { unpackArchive } from "../../src/lib/previews/unpack";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✓" : "✗"} ${name}`);
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "unpack-test-"));
/** A zip built by python from {name: bytes-or-text} (symlink: name -> "@link:target"). */
function zipOf(entries: Record<string, string>): Uint8Array {
  const out = path.join(tmp, `${Math.random().toString(36).slice(2)}.zip`);
  execFileSync("python3", [
    "-I",
    "-c",
    `
import json, sys, zipfile
entries = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for name, body in entries.items():
        if body.startswith('@link:'):
            info = zipfile.ZipInfo(name); info.create_system = 3; info.external_attr = (0o120777 << 16)
            z.writestr(info, body[6:])
        else:
            z.writestr(name, body)
`,
    out,
    JSON.stringify(entries),
  ]);
  return new Uint8Array(readFileSync(out));
}
const fresh = () => path.join(mkdtempSync(path.join(tmp, "dest-")));

async function main() {
  let dir = fresh();
  let res = await unpackArchive(zipOf({ "index.html": "<h1>hi</h1>", "img/a.jpg": "JPEG" }), dir);
  ok(res.ok && res.files === 2, "a plain site unpacks");
  ok(readFileSync(path.join(dir, "img/a.jpg"), "utf8") === "JPEG", "…with its folders");

  dir = fresh();
  res = await unpackArchive(zipOf({ "site/index.html": "x", "site/css/s.css": "y" }), dir);
  ok(res.ok && existsSync(path.join(dir, "index.html")), "one wrapping folder is stripped");

  dir = fresh();
  res = await unpackArchive(
    zipOf({
      "index.html": "x",
      ".git/config": "secret",
      "__MACOSX/._index.html": "junk",
      ".DS_Store": "junk",
    }),
    dir,
  );
  ok(
    res.ok && !existsSync(path.join(dir, ".git")) && !existsSync(path.join(dir, ".DS_Store")),
    ".git and macOS litter are skipped",
  );

  dir = fresh();
  res = await unpackArchive(zipOf({ "index.html": "x", "../escape.txt": "no" }), dir);
  ok(!res.ok && /unsafe/.test(res.ok ? "" : res.error), "a path that climbs out is refused");
  ok(!existsSync(path.join(dir, "..", "escape.txt")), "…and nothing was written outside");

  dir = fresh();
  res = await unpackArchive(zipOf({ "index.html": "x", "/abs.txt": "no" }), dir);
  ok(!res.ok, "an absolute path is refused");

  dir = fresh();
  res = await unpackArchive(zipOf({ "index.html": "x", link: "@link:/etc/passwd" }), dir);
  ok(res.ok && !existsSync(path.join(dir, "link")), "a symlink is dropped, not followed");

  dir = fresh();
  res = await unpackArchive(zipOf({ "about.html": "x" }), dir);
  ok(
    !res.ok && /index\.html/.test(res.ok ? "" : res.error),
    "no index.html: refused, and says why",
  );

  res = await unpackArchive(new TextEncoder().encode("not a zip"), fresh());
  ok(!res.ok, "something that is not a zip is refused");

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\npreview-unpack: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
