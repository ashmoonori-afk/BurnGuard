#!/usr/bin/env bun
/** Package the native x64 window around the existing portable backend. */
import { $ } from "bun";
import { cp, copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION } from "../packages/shared/src/app";

const root = path.resolve(import.meta.dir, "..");
if (process.platform !== "win32") throw new Error("Build the Windows app on Windows with the .NET 8 SDK installed.");
if (!Bun.which("dotnet")) throw new Error("Install the .NET 8 SDK to build the native Windows window.");
await readFile(path.join(root, "dist/windows/resources/burnguard-runtime.json"));
const distribution = await realpath(path.join(root, "dist"));
const output = path.join(distribution, "windows-native");
// Only replace our fixed build directory, never an environment-selected path.
if (path.dirname(output) !== distribution || path.basename(output) !== "windows-native") throw new Error("Invalid native output directory");
await rm(output, { recursive: true, force: true });
await mkdir(output);

// Reuse the existing brand mark as a PNG-backed Windows icon.
const { createCanvas, loadImage } = await import(Bun.resolveSync("@napi-rs/canvas", path.join(root, "packages/backend")));
const canvas = createCanvas(256, 256);
canvas.getContext("2d").drawImage(await loadImage(path.join(root, "packages/frontend/public/assets/burnguard-mark.png")), 0, 0, 256, 256);
const png: Buffer = canvas.toBuffer("image/png");
const iconHeader = Buffer.alloc(22);
iconHeader.writeUInt16LE(1, 2); iconHeader.writeUInt16LE(1, 4);
iconHeader.writeUInt16LE(1, 10); iconHeader.writeUInt16LE(32, 12);
iconHeader.writeUInt32LE(png.length, 14); iconHeader.writeUInt32LE(22, 18);
const icon = path.join(output, "BurnGuard.ico");
await writeFile(icon, Buffer.concat([iconHeader, png]));

const shell = path.join(distribution, "windows-native-shell");
await $`dotnet build ${path.join(root, "packages/desktop-windows/BurnGuard.Desktop.csproj")} -c Release -o ${shell} -p:ApplicationIcon=${icon} -p:Version=${APP_VERSION} --nologo`.cwd(root);
for (const name of ["BurnGuard.exe", "BurnGuard.exe.config"]) {
  await copyFile(path.join(shell, name), path.join(output, name));
}
for await (const name of new Bun.Glob("*.dll").scan(shell)) {
  if (name !== "Microsoft.Web.WebView2.Wpf.dll") await copyFile(path.join(shell, name), path.join(output, name));
}
await copyFile(path.join(shell, "runtimes/win-x64/native/WebView2Loader.dll"), path.join(output, "WebView2Loader.dll"));
await cp(path.join(root, "dist/windows"), path.join(output, "service"), { recursive: true });
// Source maps are useful during development but not required by the shipped UI.
for await (const relative of new Bun.Glob("**/*.map").scan(path.join(output, "service/resources/packages/frontend/dist"))) {
  await rm(path.join(output, "service/resources/packages/frontend/dist", relative));
}
const sdk = path.join(process.env.NUGET_PACKAGES ?? path.join(process.env.USERPROFILE!, ".nuget/packages"), "microsoft.web.webview2/1.0.4191.47");
await mkdir(path.join(output, "licenses"));
for (const name of ["LICENSE.txt", "NOTICE.txt"]) await copyFile(path.join(sdk, name), path.join(output, "licenses", `WebView2-${name}`));
await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await copyFile(path.join(root, "packages/desktop-windows/Velopack-LICENSE"), path.join(output, "licenses/Velopack-LICENSE"));
await copyFile(path.join(path.dirname(path.dirname(sdk)), "newtonsoft.json/13.0.4/LICENSE.md"), path.join(output, "licenses/Newtonsoft-LICENSE.md"));
await writeFile(path.join(output, "README.txt"), `BurnGuard ${APP_VERSION} — Windows x64\r\n\r\nExtract the entire folder and double-click BurnGuard.exe. Keep service/ beside it.\r\nWindows 10/11 with .NET Framework 4.8 and Microsoft Edge WebView2 Runtime required.\r\nWebView2: https://go.microsoft.com/fwlink/p/?LinkId=2124703\r\n\r\nThe app owns its local engine at 127.0.0.1:14070. Stop an existing browser-mode\r\nBurnGuard server before opening this app. Closing the window stops active work.\r\nYour existing projects remain in %USERPROFILE%\\.burnguard.\r\nAI generation still requires authenticated Claude Code or Codex CLI.\r\nRendering needs a supported Chrome/Edge/Chromium; PDF/PPTX intake needs Python/pypdf.\r\n\r\nThis raw build folder is unsigned. For automatic updates, distribute the installer\r\nor portable package produced by bun run build:windows:release (dist/releases).\r\nhttps://github.com/ashmoonori-afk/BurnGuard\r\n`);
const archive = path.join(distribution, `BurnGuard-${APP_VERSION}-windows-x64.zip`);
const archiveRequested = !process.argv.includes("--skip-zip");
if (archiveRequested) {
  await rm(archive, { force: true });
  const psQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  await $`powershell.exe -NoProfile -NonInteractive -Command ${`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(output)}, ${psQuote(archive)}, [IO.Compression.CompressionLevel]::Optimal, $true)`}`;
}
let unpackedBytes = 0;
for await (const file of new Bun.Glob("**/*").scan({ cwd: output, onlyFiles: true })) unpackedBytes += (await stat(path.join(output, file))).size;
const receipt = { version: APP_VERSION, unpackedBytes, zipBytes: archiveRequested ? (await stat(archive)).size : null, shellBytes: (await stat(path.join(output, "BurnGuard.exe"))).size, chromiumBundled: false };
await writeFile(path.join(distribution, "windows-native-build.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
console.log(`[native] Run ${path.join(output, "BurnGuard.exe")}`);
if (archiveRequested) console.log(`[native] Share ${archive}`);
