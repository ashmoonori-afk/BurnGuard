import { appendFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { logsDir } from "../lib/paths";

function sessionTracePath(sessionId: string) {
  return path.join(logsDir, `${sessionId}.trace.log`);
}

export async function appendSessionTrace(
  sessionId: string,
  record: Record<string, unknown>,
) {
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(logsDir, 0o700);
  const line = `${JSON.stringify({ ts: Date.now(), ...record })}\n`;
  const tracePath = sessionTracePath(sessionId);
  await appendFile(tracePath, line, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(tracePath, 0o600);
}

