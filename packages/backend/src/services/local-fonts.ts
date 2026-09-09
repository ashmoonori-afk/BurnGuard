import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseLocalFonts, type LocalFontsV1 } from "@bg/shared";

const run = promisify(execFile);
let pending: Promise<LocalFontsV1> | null = null;

export function getLocalFonts(): Promise<LocalFontsV1> {
  if (process.platform !== "win32") return Promise.reject(new Error("local_fonts_unavailable"));
  // Cache only this family-name snapshot; no font files or private paths leave the process.
  pending ??= run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; try { ConvertTo-Json -Compress -InputObject @($fonts.Families | ForEach-Object { $_.Name }) } finally { $fonts.Dispose() }"], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" })
    .then(({ stdout }) => parseLocalFonts({ schema_version: 1, families: JSON.parse(stdout.replace(/^\uFEFF/, "")) }))
    .catch(() => { pending = null; throw new Error("local_fonts_unavailable"); });
  return pending;
}
