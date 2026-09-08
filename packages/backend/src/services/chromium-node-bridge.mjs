import { chromium } from "playwright-core";

let server;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await server?.close(); } finally { process.exit(0); }
}
if (process.argv[2] !== "--probe") {
  process.stdin.resume();
  process.stdin.once("end", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
}

try {
  if (process.argv[2] === "--probe") {
    for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
      try {
        server = await chromium.launchServer({ ...options, headless: true, host: "127.0.0.1", timeout: 12000 });
        await server.close();
        process.stdout.write("usable");
        process.exit(0);
      } catch {}
    }
    process.exit(1);
  }
  const options = JSON.parse(process.argv[2] ?? "{}");
  server = await chromium.launchServer({ headless: true, host: "127.0.0.1", ...(typeof options.channel === "string" ? { channel: options.channel } : {}), timeout: 20000 });
  if (closing) { await server.close(); process.exit(0); }
  process.stdout.write(JSON.stringify({ endpoint: server.wsEndpoint() }) + "\n");
} catch {
  process.stderr.write("Chromium bridge launch failed\n");
  process.exit(1);
}
