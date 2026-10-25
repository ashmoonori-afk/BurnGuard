import { renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { serve } from "../../src/services/chromium-node-bridge.mjs";

// The bridge's ESM import and this require share the backend's Playwright instance.
const backendRequire = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = backendRequire("playwright-core");
const launchServer = chromium.launchServer.bind(chromium);
const events = new Set([
  "Page.frameAttached", "Page.frameDetached", "Page.frameNavigated",
  "Page.frameStartedLoading", "Page.frameStoppedLoading", "Page.lifecycleEvent",
  "Target.attachedToTarget", "Target.detachedFromTarget",
]);
const keyTypes = new Set(["keyDown", "keyUp", "rawKeyDown", "char"]);
const records = [];
// Keep unanswered sends separately: rotating recent events must not erase their identity.
const pending = new Map();
const started = performance.now();
let sequence = 0;
let launch = 0;
let pendingOverflow = 0;
let oversizedMessages = 0;
let captureFailed = false;
const destination = path.join(process.cwd(), "deck-node-protocol.json");
try {
  writeFileSync(destination, JSON.stringify({ records, pending: [], pendingOverflow, oversizedMessages }), { flag: "wx", mode: 0o600 });
} catch {
  // Diagnostic I/O must not reject a browser operation. The reader reports unavailable.
  captureFailed = true;
}

function writeSnapshot() {
  const snapshot = JSON.stringify({ records, pending: [...pending.values()], pendingOverflow, oversizedMessages });
  // The failure reader sees a complete prior or current snapshot, never an in-place rewrite.
  writeFileSync(`${destination}.next`, snapshot, { flag: "wx", mode: 0o600 });
  renameSync(`${destination}.next`, destination);
}

function record(entry) {
  const item = { seq: ++sequence, elapsed_ms: Math.round(performance.now() - started), ...entry };
  records.push(item);
  if (records.length > 256) records.shift();
  if (item.kind === "send") {
    if (pending.size < 256) pending.set(`${item.launch}:${item.id}`, item);
    else pendingOverflow += 1; // Preserve admitted identities; saturation makes absence inconclusive.
  }
  writeSnapshot();
}

chromium.launchServer = (options) => {
  const attempt = ++launch;
  return launchServer({
    ...options,
    logger: {
      isEnabled: (name, severity) => !captureFailed && name === "protocol" && severity === "verbose",
      log(name, severity, message) {
        if (captureFailed || name !== "protocol" || severity !== "verbose" || typeof message !== "string") return;
        // Playwright supplies serialized protocol messages; never retain or write that input.
        try {
          // Normal fixture bundles exceed 64 KiB; bound transient parsing without retaining them.
          if (message.length > 4_194_304) { oversizedMessages += 1; writeSnapshot(); return; }
          const sent = message.startsWith("SEND \u25ba ");
          if (!sent && !message.startsWith("\u25c0 RECV ")) return;
          const value = JSON.parse(message.slice(7));
          if (value === null || typeof value !== "object") return;
          if (sent && Number.isSafeInteger(value.id) && value.id > 0) {
            switch (value.method) {
              case "Input.dispatchKeyEvent":
                if (!keyTypes.has(value.params?.type)) return;
                record({ launch: attempt, kind: "send", id: value.id, method: "Input.dispatchKeyEvent",
                  type: value.params.type, isEscape: value.params.key === "Escape" });
                return;
              case "Page.enable":
                record({ launch: attempt, kind: "send", id: value.id, method: "Page.enable" });
                return;
              default:
                return;
            }
          }
          if (sent) return;
          if (Number.isSafeInteger(value.id) && value.id > 0) {
            const key = `${attempt}:${value.id}`;
            const command = pending.get(key);
            if (command === undefined) return;
            pending.delete(key);
            const { seq: _seq, elapsed_ms: _elapsed, ...identity } = command;
            record({ ...identity, kind: "receive", error: Boolean(value.error) });
          } else if (events.has(value.method)) {
            record({ launch: attempt, kind: "event", method: value.method });
          }
        } catch {
          // Parsing or sink failure cannot interrupt CDP dispatch or acknowledgement.
          captureFailed = true;
        }
      },
    },
  });
};

// Node 24 does not run the imported bridge's guarded entrypoint.
await serve();
