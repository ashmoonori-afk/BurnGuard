import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseLocalFonts, type LocalFontsV1 } from "@bg/shared";

const run = promisify(execFile);
let pending: Promise<LocalFontsV1> | null = null;

/** Each host enumerates installed families through its own OS API; every other platform has none. */
function familyListCommand(platform: NodeJS.Platform): { file: string; args: string[] } | null {
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; try { ConvertTo-Json -Compress -InputObject @($fonts.Families | ForEach-Object { $_.Name }) } finally { $fonts.Dispose() }"] };
  if (platform === "darwin") return { file: "/usr/bin/osascript", args: ["-l", "JavaScript", "-e", "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"] };
  return null;
}

export function getLocalFonts(): Promise<LocalFontsV1> {
  const command = familyListCommand(process.platform);
  if (!command) return Promise.reject(new Error("local_fonts_unavailable"));
  // Cache only this family-name snapshot; no font files or private paths leave the process.
  pending ??= run(command.file, command.args, { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" })
    .then(({ stdout }) => parseLocalFonts({ schema_version: 1, families: (JSON.parse(stdout.replace(/^\uFEFF/, "")) as string[]).slice().sort((left, right) => left.localeCompare(right)) }))
    .catch(() => { pending = null; throw new Error("local_fonts_unavailable"); });
  return pending;
}
