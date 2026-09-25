import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const entry = path.resolve(import.meta.dir, "../src/index.ts");
const roots: string[] = [];

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** Resolves once the backend prints its listening line; the spawn timeout bounds the wait. */
async function listening(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder(); let text = "";
  for await (const chunk of stdout) {
    text += decoder.decode(chunk, { stream: true });
    if (/\[burnguard\] listening on http:\/\/127\.0\.0\.1:\d+\n/.test(text)) return text;
  }
  throw new Error(`backend exited before listening: ${text}`);
}

// A terminal hangup is a POSIX signal; Windows console close is delivered differently.
test.skipIf(process.platform === "win32")("Given a running backend started from a terminal When the terminal hangs up Then the ordered shutdown runs and the process exits cleanly", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "bg-signals-")));
  roots.push(root);
  const child = Bun.spawn([process.execPath, entry], {
    env: { ...process.env, BG_APP_ROOT: path.join(root, "app"), BG_PORT: "0", BG_NO_OPEN: "1", BG_DESKTOP: "0", BG_DEV: "0", CODEX_HOME: path.join(root, "codex"), CLAUDE_CONFIG_DIR: path.join(root, "claude") },
    stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 60_000,
  });

  await listening(child.stdout);
  child.kill("SIGHUP");
  await child.exited;

  expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({ exitCode: 0, signalCode: null });
}, 90_000);
