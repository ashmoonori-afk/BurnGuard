import path from "node:path";

const WINDOWS_CHANNELS = [["Google", "Chrome", "Application", "chrome.exe"], ["Microsoft", "Edge", "Application", "msedge.exe"]] as const;
const MAC_CHANNELS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] as const;
const LINUX_CHANNELS = ["/opt/google/chrome/chrome", "/opt/microsoft/msedge/msedge"] as const;

/**
 * Where playwright-core 1.59.1 looks for the "chrome" and "msedge" channels the launcher falls back to
 * (lib/server/registry). A host with one of these has a browser even when Playwright's own build is absent.
 */
export function systemBrowserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): readonly string[] {
  if (platform === "darwin") return MAC_CHANNELS;
  if (platform !== "win32") return LINUX_CHANNELS;
  const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter((root): root is string => root !== undefined && root !== "");
  return roots.flatMap((root) => WINDOWS_CHANNELS.map((segments) => path.win32.join(root, ...segments)));
}

export async function anyBrowserOnDisk(candidates: readonly string[], isFile: (candidate: string) => Promise<boolean>): Promise<boolean> {
  for (const candidate of candidates) {
    if (await isFile(candidate).catch(() => false)) return true;
  }
  return false;
}
