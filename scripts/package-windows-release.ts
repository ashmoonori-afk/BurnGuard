#!/usr/bin/env bun
/** Build publishable installers/update assets; publication is a separate release step. */
import { $ } from "bun";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "../packages/shared/src/app";

const root = path.resolve(import.meta.dir, "..");
if (process.platform !== "win32") throw new Error("Windows release packaging requires Windows.");
if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION)) throw new Error("Release version must be a stable semantic version.");
for (const relative of ["package.json", "packages/backend/package.json", "packages/frontend/package.json", "packages/shared/package.json"]) {
  if (JSON.parse(await readFile(path.join(root, relative), "utf8")).version !== APP_VERSION) throw new Error(`Version mismatch: ${relative}`);
}
const input = path.join(root, "dist/windows-native");
const marker = JSON.parse(await readFile(path.join(input, "service/resources/burnguard-runtime.json"), "utf8"));
if (marker.version !== APP_VERSION) throw new Error("Rebuild the native app before packaging a new release.");
const distribution = await realpath(path.join(root, "dist"));
const output = path.join(distribution, "releases");
if (path.dirname(output) !== distribution || path.basename(output) !== "releases") throw new Error("Invalid release output directory");
await rm(output, { recursive: true, force: true });
await $`dotnet tool restore`.cwd(root);
await $`dotnet tool run vpk -- pack --packId BurnGuard --packVersion ${APP_VERSION} --packDir ${input} --mainExe BurnGuard.exe --packTitle BurnGuard --packAuthors BurnGuard --runtime win-x64 --channel win --icon ${path.join(input, "BurnGuard.ico")} --outputDir ${output}`.cwd(root);
const files = [];
for await (const name of new Bun.Glob("*").scan({ cwd: output, onlyFiles: true })) {
  if (name === "SHA256SUMS.txt") continue;
  const bytes = await readFile(path.join(output, name));
  files.push(`${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}  ${name}`);
}
await writeFile(path.join(output, "SHA256SUMS.txt"), files.sort().join("\n") + "\n");
console.log(`[release] ${APP_VERSION}: installer, portable app, and update feed ready in dist/releases`);
