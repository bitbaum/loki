/**
 * Bring a finished site into a preview folder from a .zip: for the site that
 * already exists (made in a design tool, handed over by a friend, built in an
 * earlier session) and only needs an address, the access code and the widget.
 *
 * Extraction is done by python's zipfile because it is on every box and Node
 * has no zip reader; the script, not the archive, decides every path. It
 * refuses absolute paths, `..`, backslashes and symlinks, skips `.git` and
 * macOS litter, counts bytes as it copies (a header can lie about size), and
 * requires an index.html at the top (a single wrapping folder is stripped).
 */
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const run = promisify(execFile);

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_UNPACKED_BYTES = 150 * 1024 * 1024;

const SCRIPT = `
import os, stat, sys, zipfile
zip_path, dest, max_files, max_bytes = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
z = zipfile.ZipFile(zip_path)
def skip(n):
    parts = n.split('/')
    return parts[0] == '__MACOSX' or parts[-1] == '.DS_Store' or '.git' in parts
infos = [i for i in z.infolist() if not i.is_dir() and not skip(i.filename)]
if not infos: sys.exit('The archive is empty.')
if len(infos) > max_files: sys.exit('Too many files in the archive.')
tops = {i.filename.split('/')[0] for i in infos}
strip = ''
if len(tops) == 1 and all('/' in i.filename for i in infos): strip = next(iter(tops)) + '/'
root = os.path.realpath(dest)
total = count = 0
for i in infos:
    if stat.S_ISLNK((i.external_attr >> 16) & 0xFFFF): continue
    rel = i.filename[len(strip):]
    if not rel or rel.startswith('/') or '\\\\' in rel: sys.exit('The archive has an unsafe path: ' + i.filename)
    target = os.path.realpath(os.path.join(root, rel))
    if not target.startswith(root + os.sep): sys.exit('The archive has an unsafe path: ' + i.filename)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with z.open(i) as src, open(target, 'wb') as out:
        while True:
            chunk = src.read(1 << 20)
            if not chunk: break
            total += len(chunk)
            if total > max_bytes: sys.exit('The archive is too large once unpacked.')
            out.write(chunk)
    count += 1
if not os.path.isfile(os.path.join(root, 'index.html')): sys.exit('There is no index.html at the top of the archive.')
print(count)
`;

export type Unpacked = { ok: true; files: number } | { ok: false; error: string };

export async function unpackArchive(zip: Uint8Array, dir: string): Promise<Unpacked> {
  if (zip.byteLength > MAX_ARCHIVE_BYTES) {
    return { ok: false, error: "The archive is larger than 25 MB. Compress the images first." };
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), "preview-zip-"));
  try {
    const file = path.join(tmp, "site.zip");
    await writeFile(file, zip);
    const { stdout } = await run(
      "python3",
      ["-I", "-c", SCRIPT, file, dir, String(MAX_FILES), String(MAX_UNPACKED_BYTES)],
      { timeout: 60_000 },
    );
    return { ok: true, files: Number.parseInt(stdout.trim(), 10) || 0 };
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr?.trim().split("\n").pop();
    return {
      ok: false,
      error: stderr || "That file is not a zip archive Loki can read.",
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
