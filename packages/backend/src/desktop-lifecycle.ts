import type { Readable } from "node:stream";

export function desktopPort(value: string | undefined): number {
  if (value === undefined) return 14070;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid desktop BG_PORT");
  }
  return port;
}

/** Only the owning desktop parent's private stdin pipe controls shutdown. */
export function watchDesktopParent(input: Readable, shutdown: () => void): void {
  let line = "";
  let discarded = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    shutdown();
  };
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    for (const character of chunk) {
      if (character === "\n") {
        if (!discarded && (line === "shutdown" || line === "shutdown\r")) stop();
        line = "";
        discarded = false;
      } else if (!discarded) {
        if (line.length >= 32) { line = ""; discarded = true; }
        else line += character;
      }
    }
  });
  input.once("end", stop);
  input.once("error", stop);
  input.resume();
}

export type DesktopStartupFailure = "port_busy" | "profile_owned" | "invalid_port";

/** Runs one startup step; on failure tells the native shell which known cause it was, then exits non-zero without a stack trace. */
export async function desktopStartupStep<T>(code: DesktopStartupFailure, step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch {
    console.log(`[burnguard-desktop] ${JSON.stringify({ protocol: 1, event: "startup_failed", code })}`);
    process.exit(1);
  }
}
