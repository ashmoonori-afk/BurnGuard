import type { Readable } from "node:stream";

export function desktopPort(value: string | undefined): number {
  if (value === undefined) return 14070;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid desktop BG_PORT");
  }
  return port;
}

/** The reply a shell reads before it confirms closing over a running generation. */
export function activeTurnsMessage(count: number): string {
  return `[burnguard-desktop] ${JSON.stringify({ protocol: 1, event: "active-turns", count })}`;
}

/** Only the owning desktop parent's private stdin pipe controls shutdown or asks for the running-turn count. */
export function watchDesktopParent(input: Readable, shutdown: () => void, reportActiveTurns: () => void = () => {}): void {
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
        const command = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!discarded && command === "shutdown") stop();
        else if (!discarded && command === "active-turns" && !stopped) reportActiveTurns();
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
