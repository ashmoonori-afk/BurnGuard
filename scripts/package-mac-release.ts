#!/usr/bin/env bun
/**
 * Build the macOS Velopack release assets (installer .pkg, portable .zip, full
 * .nupkg, releases.osx.json feed) from the .app that `build-mac.ts` produced.
 * Publication is a separate release step; this only writes dist/releases.
 *
 * Signing and notarization run only when credentials are present:
 *   BG_MAC_SIGN_IDENTITY       Developer ID Application certificate subject
 *   BG_MAC_INSTALL_IDENTITY    Developer ID Installer certificate subject
 *   BG_MAC_NOTARY_PROFILE      notarytool keychain profile name
 */
import { $ } from "bun";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
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
if (process.env.BG_MAC_SIGN_IDENTITY) signing.push("--signAppIdentity", process.env.BG_MAC_SIGN_IDENTITY);
if (process.env.BG_MAC_INSTALL_IDENTITY) signing.push("--signInstallIdentity", process.env.BG_MAC_INSTALL_IDENTITY);
if (process.env.BG_MAC_NOTARY_PROFILE) signing.push("--notaryProfile", process.env.BG_MAC_NOTARY_PROFILE);
if (signing.length === 0) console.warn("[release] unsigned package: set BG_MAC_SIGN_IDENTITY, BG_MAC_INSTALL_IDENTITY and BG_MAC_NOTARY_PROFILE for a distributable build");

// `[osx]` is interpolated so the Bun shell never treats it as a glob.
const platform = "[osx]";
await $`dotnet tool restore`.cwd(root);
// The pack id and feed channel pair with the Windows release so one GitHub release serves both feeds.
await $`dotnet tool run vpk -- ${platform} pack --packId BurnGuard --packVersion ${APP_VERSION} --packDir ${bundle} --mainExe BurnGuard --packTitle BurnGuard --packAuthors BurnGuard --channel osx --icon ${path.join(root, "assets/icon.icns")} --outputDir ${output} ${signing}`.cwd(root);

const files: string[] = [];
for await (const name of new Bun.Glob("*").scan({ cwd: output, onlyFiles: true })) {
  if (name === "SHA256SUMS.txt") continue;
  const bytes = await readFile(path.join(output, name));
  files.push(`${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}  ${name}`);
}
await writeFile(path.join(output, "SHA256SUMS.txt"), files.sort().join("\n") + "\n");
console.log(`[release] ${APP_VERSION}: macOS installer, portable app, and update feed ready in dist/releases`);
