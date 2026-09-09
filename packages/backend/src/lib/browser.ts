/** Returns the platform-native command without launching it. */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): readonly string[] {
  switch (platform) {
    case "win32":
      return ["cmd", "/c", "start", "", url];
    case "darwin":
      return ["open", url];
    default:
      return ["xdg-open", url];
  }
}

type BrowserLauncher = (command: readonly string[]) => void;

/** Cross-platform "open URL in default browser". */
export function openBrowser(url: string, launch?: BrowserLauncher): void {
  if (process.env.BG_NO_OPEN === "1" || process.env.BG_DESKTOP === "1") return;

  try {
    const command = browserOpenCommand(process.platform, url);
    if (launch !== undefined) launch(command);
    else Bun.spawn([...command], { stdout: "ignore", stderr: "ignore" });
  } catch (err) {
    console.warn("[burnguard] could not auto-open browser:", err);
  }
}
