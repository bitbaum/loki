# Fleet Runner desktop — release & code-signing runbook

The multi-platform build+publish pipeline already exists
(`.github/workflows/desktop-release.yml`): a `fleet-runner-v*` tag builds macOS
`.dmg`/`.zip`, Windows NSIS `.exe`, and Linux `.AppImage`/`.deb`, and publishes
them to a draft GitHub Release. This is the only thing standing between
Mac/Windows users and running an agent.

## What an unsigned Mac build looks like to the person who downloads it

**“Fleet Runner is damaged and can’t be opened. You should move it to the
Trash.”** That is Gatekeeper’s wording on a current macOS for an app that
carries no Apple Developer ID signature — not a corrupt download. The owner
read it as a broken file on 2026-10-12. Control-click → Open does not clear
this dialog (it only ever cleared the older “unidentified developer” one);
removing the quarantine flag does:

```
xattr -cr "/Applications/Fleet Runner.app"
```

`/download` therefore leads with the `.zip` and one Terminal line
(`ditto -xk … && xattr -cr … && open -a …`), which is the only install path
that never meets the dialog. Until the build is signed and notarized, every
Mac user pays that one pasted line. What signing costs: an Apple Developer
Program membership (USD 99 a year, enrolled by the owner under their Apple
ID) plus the steps in B below. Nothing in the pipeline is waiting on code.

## A. Ship NOW (unsigned) — no certificates needed

macOS/Windows can ship today. The installers build unsigned; the `/download`
page carries the one-line install that clears Gatekeeper’s refusal (above).

1. Bump `desktop/package.json` `version`, commit.
2. Tag and push:
   ```
   git tag fleet-runner-v<X.Y.Z> && git push origin fleet-runner-v<X.Y.Z>
   ```
3. The workflow builds all three OSes and uploads to a **draft** release.
4. Mirror the draft to the public host:
   ```
   scripts/mirror-desktop-release.sh <X.Y.Z>
   ```
5. Flip `macOS` / `Windows` from `comingSoon` → `ready` in
   `src/config/marketing-content.ts` (do this ONLY once a real asset exists —
   never before, or it's a fake "ready" claim).

That's a downloadable Mac/Windows runner. Signing (below) just removes the
"unidentified developer" friction — do it when you have the certificates.

## B. Ship SIGNED — removes the Gatekeeper warning

The workflow already passes the signing secrets through (gated: unset → unsigned,
so A keeps working). To enable signing:

### macOS (Developer ID + notarization)
Requires an Apple Developer account.
1. Export your **Developer ID Application** cert as a `.p12`, base64 it, and add repo secrets:
   - `MAC_CSC_LINK` = base64 of the `.p12`
   - `MAC_CSC_KEY_PASSWORD` = its password
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (an app-specific password), `APPLE_TEAM_ID`
2. Add the hardened-runtime + entitlements config to `desktop/package.json` `build.mac`
   (node-pty needs the JIT entitlements or notarization rejects it):
   ```jsonc
   "mac": {
     …,
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "resources/entitlements.mac.plist",
     "entitlementsInherit": "resources/entitlements.mac.plist",
     "notarize": { "teamId": "<APPLE_TEAM_ID>" }
   }
   ```
3. Create `desktop/resources/entitlements.mac.plist` (it does not exist yet):
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.security.cs.allow-jit</key><true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
     <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
     <key>com.apple.security.cs.disable-library-validation</key><true/>
   </dict></plist>
   ```
4. Tag as in A — the mac build is now signed + notarized (no warning).

### Windows (Authenticode)
Add `WIN_CSC_LINK` (base64 `.pfx`) + `WIN_CSC_KEY_PASSWORD` secrets. electron-builder
signs automatically; tag as in A.

## Why this isn't automatable end-to-end
Certificates are credentials tied to your Apple/Windows developer identity, and
minting a public release is a distribution decision — both are yours. Everything
that doesn't need them (the pipeline, the Windows publish-case bug fix, the gated
signing hook) is done.
