import fs from "fs";
import os from "os";
import path from "path";

function escapeTomlKey(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function addTrustedGrokFolder(raw: string, dir: string, decidedAt: number): string {
  const header = `[folders."${escapeTomlKey(dir)}"]`;
  if (raw.includes(header)) {
    const start = raw.indexOf(header);
    const next = raw.indexOf("\n[", start + header.length);
    const end = next === -1 ? raw.length : next;
    const block = raw.slice(start, end);
    const trusted = /(^|\n)trusted\s*=\s*true(\n|$)/.test(block)
      ? block
      : block.replace(/(^|\n)trusted\s*=\s*false(\n|$)/, "$1trusted = true$2");
    return raw.slice(0, start) + trusted + raw.slice(end);
  }
  const prefix = raw.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${header}\ntrusted = true\ndecided_at = ${decidedAt}\n`;
}

/** Trust exactly the checkout Fleet Runner is about to hand to Grok. */
export function ensureGrokWorkspaceTrusted(dir: string): void {
  const configDir = path.join(os.homedir(), ".grok");
  const file = path.join(configDir, "trusted_folders.toml");
  fs.mkdirSync(configDir, { recursive: true });
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = addTrustedGrokFolder(raw, dir, Math.floor(Date.now() / 1000));
  if (next !== raw) fs.writeFileSync(file, next, { mode: 0o600 });
}
