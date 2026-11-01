// electron-builder afterPack hook: puts desktop/scripts/linux-launcher.sh in
// front of the Linux Electron binary.
//
// Why a launcher at all: a Linux AppImage mounts a squashfs volume that strips
// the SUID bit from chrome-sandbox. Where unprivileged user namespaces are
// also unavailable, Chromium aborts before any of our own code runs:
//
//   FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was
//   found, but is not configured correctly. ... You need to make sure that
//   ... chrome-sandbox is owned by root and has mode 4755.
//
// The flag that avoids that abort has to be on argv before Chromium starts:
// app.commandLine.appendSwitch('no-sandbox') in main runs too late, and
// electron-builder's `linux.executableArgs` only reaches the .desktop file's
// Exec= line, not a direct launch of the AppImage. (It defaults to
// --no-sandbox for AppImage, which is why package.json sets it to [].)
// electron-builder's generated AppRun also appends --no-sandbox, silently,
// when its own `unshare -Ur true` probe fails; the launcher reports that too.
//
// This hook used to bake --no-sandbox in unconditionally, so every Linux
// user ran with the renderer sandbox off, including the many whose machine
// could sandbox perfectly well through user namespaces. The launcher now
// probes for that and adds --no-sandbox only where Chromium would otherwise
// abort, saying why on stderr and in the app. See linux-launcher.sh.
//
// Scoped to Linux: mac .dmg and Windows .exe have no SUID helper.
// desktop/scripts/test-linux-sandbox.sh proves the packaged AppImage in CI.

const fs = require('fs');
const path = require('path');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  // electron-builder copies the Electron binary into appOutDir under the
  // executable name: "Fleet Runner" becomes "fleet-runner".
  const execName = context.packager.executableName;
  const appOutDir = context.appOutDir;
  const realBinaryPath = path.join(appOutDir, execName);
  const movedBinaryPath = path.join(appOutDir, `${execName}-bin`);

  if (!fs.existsSync(realBinaryPath)) {
    throw new Error(`[afterPack] expected the Electron binary at ${realBinaryPath}; it is missing`);
  }

  // afterPack can run twice (multi-arch, retries): wrap once.
  if (!fs.existsSync(movedBinaryPath)) {
    fs.renameSync(realBinaryPath, movedBinaryPath);
  }

  const template = fs.readFileSync(path.join(__dirname, 'linux-launcher.sh'), 'utf8');
  fs.writeFileSync(realBinaryPath, template.replaceAll('@EXEC@', execName), { mode: 0o755 });
  console.log(`[afterPack] installed linux-launcher.sh as ${execName} (Electron moved to ${execName}-bin)`);
};
