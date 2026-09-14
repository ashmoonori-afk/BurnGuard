#!/usr/bin/env bun
/**
 * Build the macOS Velopack release assets (installer .pkg, portable .zip, full
 * .nupkg, releases.osx.json feed) from the .app that `build-mac.ts` produced.
 * Publication is a separate release step; this only writes dist/releases.
 *
 * Signing and notarization are optional; omit all three for free unsigned distribution:
 *   BG_MAC_SIGN_IDENTITY       Developer ID Application certificate subject
 *   BG_MAC_INSTALL_IDENTITY    Developer ID Installer certificate subject
 *   BG_MAC_NOTARY_PROFILE      notarytool keychain profile name
 */
import { $ } from "bun";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "../packages/shared/src/app";

const root = path.resolve(import.meta.dir, "..");
if (process.platform !== "darwin") throw new Error("macOS release packaging requires macOS.");
if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION)) throw new Error("Release version must be a stable semantic version.");
for (const relative of ["package.json", "packages/backend/package.json", "packages/frontend/package.json", "packages/shared/package.json"]) {
  if (JSON.parse(await readFile(path.join(root, relative), "utf8")).version !== APP_VERSION) throw new Error(`Version mismatch: ${relative}`);
}
const bundle = path.join(root, "dist/mac/BurnGuard Design.app");
const marker = JSON.parse(await readFile(path.join(bundle, "Contents/MacOS/resources/burnguard-runtime.json"), "utf8"));
if (marker.version !== APP_VERSION) throw new Error("Rebuild the macOS app before packaging a new release.");
const distribution = await realpath(path.join(root, "dist"));
const output = path.join(distribution, "releases");
if (path.dirname(output) !== distribution || path.basename(output) !== "releases") throw new Error("Invalid release output directory");
await rm(output, { recursive: true, force: true });

const signing: string[] = [];
const requiredSigning = [
  ["BG_MAC_SIGN_IDENTITY", "--signAppIdentity"],
  ["BG_MAC_INSTALL_IDENTITY", "--signInstallIdentity"],
  ["BG_MAC_NOTARY_PROFILE", "--notaryProfile"],
] as const;
const signingConfigured = requiredSigning.some(([key]) => Boolean(process.env[key]));
for (const [environmentKey, argument] of signingConfigured ? requiredSigning : []) {
  const value = process.env[environmentKey];
  if (!value) throw new Error(`[release] ${environmentKey} is required when signing is configured`);
  signing.push(argument, value);
}

if (!signingConfigured) console.log("[release] Building without Developer ID signing or notarization.");

// `[osx]` is interpolated so the Bun shell never treats it as a glob.
const platform = "[osx]";
await $`dotnet tool restore`.cwd(root);
// The pack id and feed channel pair with the Windows release so one GitHub release serves both feeds.
await $`dotnet tool run vpk -- ${platform} pack --packId BurnGuard --packVersion ${APP_VERSION} --packDir ${bundle} --mainExe BurnGuard --packTitle BurnGuard --packAuthors BurnGuard --channel osx --icon ${path.join(root, "assets/icon.icns")} --outputDir ${output} ${signing}`.cwd(root);

// Velopack 1.2.0's generated installer runs unsafe privileged cache cleanup.
// Install the same portable app with a native component package and no scripts.
const installerStage = await mkdtemp(path.join(distribution, "mac-installer-"));
try {
  await $`ditto -x -k ${path.join(output, "BurnGuard-osx-Portable.zip")} ${installerStage}`;
  const installer = path.join(output, "BurnGuard-osx-Setup.pkg");
  const safeInstaller = path.join(installerStage, "BurnGuard.pkg");
  const installerSigning = signingConfigured ? ["--sign", process.env.BG_MAC_INSTALL_IDENTITY!] : [];
  await $`pkgbuild --component ${path.join(installerStage, "BurnGuard.app")} --install-location /Applications --identifier com.burnguard.design --version ${APP_VERSION} ${installerSigning} ${safeInstaller}`;
  const expanded = path.join(installerStage, "expanded");
  await $`pkgutil --expand ${safeInstaller} ${expanded}`;
  assert.ok(!(await readdir(expanded)).includes("Scripts"), "Installer must not execute privileged scripts");
  assert.doesNotMatch(await readFile(path.join(expanded, "PackageInfo"), "utf8"), /<scripts\b/);
  if (signingConfigured) {
    await $`xcrun notarytool submit ${safeInstaller} --keychain-profile ${process.env.BG_MAC_NOTARY_PROFILE!} --wait`;
    await $`xcrun stapler staple ${safeInstaller}`;
  }
  await $`ditto ${safeInstaller} ${installer}`;
} finally {
  await rm(installerStage, { recursive: true, force: true });
}

const files: string[] = [];
for await (const name of new Bun.Glob("*").scan({ cwd: output, onlyFiles: true })) {
  if (name === "SHA256SUMS-macos.txt") continue;
  const bytes = await readFile(path.join(output, name));
  files.push(`${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}  ${name}`);
}
await writeFile(path.join(output, "SHA256SUMS-macos.txt"), files.sort().join("\n") + "\n");
console.log(`[release] ${APP_VERSION}: macOS installer, portable app, and update feed ready in dist/releases`);
