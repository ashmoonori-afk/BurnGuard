import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "../../../backend/node_modules/playwright-core";

type SchemaReport = {
  state: "captured" | "data-loss";
  browser: { product: string; revision: string };
  bytes: number;
  events: number;
  selected: { kind: string; count: number; phases: string[]; argFields: string[]; processCount: number }[];
  routing: { input: string; sent: boolean; handledBy: string[]; lastFocus: string }[];
} | { state: "unavailable"; stage: string; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("input_trace_deadline");
      controller.abort(error);
      reject(error);
    }, 5000);
  });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}

export function summarizeInputWidgetTrace(raw: string, lost: boolean, browser: { product: string; revision: string }): SchemaReport {
  // Chromium emits 64-bit trace IDs as JSON numbers. Preserve their decimal tokens before parsing.
  const parsed: unknown = JSON.parse(raw.replace(/("trace_id"\s*:\s*)(-?\d+)(?=\s*[,}])/g, '$1"$2"'));
  if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents) || parsed.traceEvents.length > 50000) {
    throw new Error("input_trace_schema");
  }
  const names = new Map([
    ["DevToolsSession::HandleCommand in Browser", "devtools"],
    ["LatencyInfo.Flow", "latency-flow"],
    ["InputRouterImpl::FilterAndSendWebInputEvent", "input-send"],
    ["RenderWidgetHostImpl::ForwardKeyboardEvent", "keyboard-forward"],
    ["RenderWidgetHostImpl::ForwardMouseEvent", "mouse-forward"],
    ["RenderFrameHostImpl::DidFocusFrame", "frame-focus"],
    ["WebContentsImpl::SetFocusedFrame", "focused-frame"],
    ["InputLatency::RawKeyDown", "raw-key-down"],
    ["InputLatency::KeyUp", "key-up"],
    ["InputLatency::MouseMove", "mouse-move"],
    ["InputLatency::MouseDown", "mouse-down"],
    ["InputLatency::MouseUp", "mouse-up"],
  ]);
  const selected = new Map<string, { count: number; phases: Set<string>; fields: Set<string>; processes: Set<number> }>();
  const fields = (value: Record<string, unknown>, into: Set<string>, prefix = "", depth = 0) => {
    for (const key in value) {
      if (into.size >= 32) break;
      if (!Object.prototype.hasOwnProperty.call(value, key) || !/^[A-Za-z_][A-Za-z0-9_.]{0,100}$/.test(key)) continue;
      const name = prefix ? `${prefix}.${key}` : key;
      if (name.length > 120) continue;
      into.add(name);
      if (depth < 2 && isRecord(value[key])) fields(value[key], into, name, depth + 1);
    }
  };
  for (const event of parsed.traceEvents) {
    if (!isRecord(event) || typeof event.name !== "string") continue;
    const kind = names.get(event.name);
    if (!kind) continue;
    let entry = selected.get(kind);
    if (!entry) {
      entry = { count: 0, phases: new Set(), fields: new Set(), processes: new Set() };
      selected.set(kind, entry);
    }
    entry.count += 1;
    if (typeof event.ph === "string" && /^[BEXbesftIn]$/.test(event.ph)) entry.phases.add(event.ph);
    if (typeof event.pid === "number" && Number.isSafeInteger(event.pid) && entry.processes.size < 64) entry.processes.add(event.pid);
    if (isRecord(event.args)) fields(event.args, entry.fields);
  }
  const processRoles = new Map<number, Set<string>>();
  const focus: { ts: number; role: string }[] = [];
  const transfers = new Map<string, { input: string; ts: number; sent: boolean; handled: Set<number> }>();
  for (const event of parsed.traceEvents) {
    if (!isRecord(event) || !isRecord(event.args) || typeof event.ts !== "number") continue;
    const args = event.args;
    const frameNode = isRecord(args.frame_tree_node) ? args.frame_tree_node : undefined;
    const frame = isRecord(args.render_frame_host) ? args.render_frame_host : frameNode?.current_frame_host;
    if (isRecord(frame) && isRecord(frame.process)) {
      const pid = frame.process.child_process_id;
      const role = frame.frame_type === "PRIMARY_MAIN_FRAME" ? "parent" : frame.frame_type === "SUBFRAME" ? "child" : "unknown";
      if (typeof pid === "number" && role !== "unknown") {
        const roles = processRoles.get(pid) ?? new Set<string>();
        roles.add(role);
        processRoles.set(pid, roles);
      }
      if (event.name === "WebContentsImpl::SetFocusedFrame") focus.push({ ts: event.ts, role });
    }
    if (event.name !== "LatencyInfo.Flow" || !isRecord(args.chrome_latency_info)) continue;
    const info = args.chrome_latency_info;
    if (typeof info.trace_id !== "string") continue;
    let transfer = transfers.get(info.trace_id);
    if (!transfer) {
      if (transfers.size >= 256) continue;
      transfer = { input: "unknown", ts: event.ts, sent: false, handled: new Set() };
      transfers.set(info.trace_id, transfer);
    }
    const input = info.input_type;
    if (input === "RAW_KEY_DOWN_EVENT" || input === "KEY_UP_EVENT" || input === "MOUSE_DOWN_EVENT" || input === "MOUSE_UP_EVENT" || input === "MOUSE_MOVE_EVENT") {
      transfer.input = input;
    }
    if (info.step === "STEP_SEND_DISPATCH_EVENT_MOJO_MESSAGE") {
      transfer.sent = true;
      transfer.ts = event.ts;
    }
    if ((info.step === "STEP_HANDLE_INPUT_EVENT_IMPL" || info.step === "STEP_HANDLE_INPUT_EVENT_MAIN") && typeof event.pid === "number") {
      transfer.handled.add(event.pid);
    }
  }
  focus.sort((a, b) => a.ts - b.ts);
  return {
    state: lost ? "data-loss" : "captured", browser, bytes: Buffer.byteLength(raw), events: parsed.traceEvents.length,
    selected: [...selected].map(([kind, entry]) => ({
      kind, count: entry.count, phases: [...entry.phases], argFields: [...entry.fields], processCount: entry.processes.size,
    })),
    routing: [...transfers.values()].filter(entry => entry.input !== "unknown").sort((a, b) => a.ts - b.ts).slice(0, 64).map(entry => ({
      input: entry.input, sent: entry.sent,
      handledBy: [...entry.handled].map(pid => {
        const roles = processRoles.get(pid);
        return roles?.size === 1 ? [...roles][0] : roles ? "shared-process" : "unknown";
      }),
      lastFocus: focus.filter(item => item.ts <= entry.ts).at(-1)?.role ?? "unknown",
    })),
  };
}

export async function beginInputWidgetTrace(page: Page): Promise<{ finish(): Promise<SchemaReport> }> {
  const { session, browser } = await bounded(async signal => {
    const created = await page.context().newCDPSession(page);
    signal.throwIfAborted();
    const version = await created.send("Browser.getVersion");
    signal.throwIfAborted();
    await created.send("Tracing.start", {
      traceConfig: {
        recordMode: "recordUntilFull", traceBufferSizeInKb: 1024,
        includedCategories: ["devtools", "input", "latencyInfo", "navigation", "content"],
      },
      transferMode: "ReturnAsStream", streamFormat: "json",
    });
    signal.throwIfAborted();
    return {
      session: created,
      browser: {
        product: /^(Chrome|HeadlessChrome|Chromium)\/[0-9.]+$/.test(version.product) ? version.product : "other",
        revision: /^@[a-f0-9]{40}$/.test(version.revision) ? version.revision.slice(1) : "unknown",
      },
    };
  });
  let finishing: Promise<SchemaReport> | undefined;
  let stage = "completion";
  return {
    finish() {
      finishing ??= bounded<SchemaReport>(async signal => {
        let receive: ((event: unknown) => void) | undefined;
        const complete = new Promise<{ stream: string; lost: boolean }>((resolve, reject) => {
          receive = event => {
            if (!isRecord(event) || typeof event.stream !== "string" || typeof event.dataLossOccurred !== "boolean") {
              reject(new Error("input_trace_completion_schema")); return;
            }
            resolve({ stream: event.stream, lost: event.dataLossOccurred });
          };
          session.once("Tracing.tracingComplete", receive);
        });
        try {
          const [, result] = await Promise.all([session.send("Tracing.end"), complete]);
          signal.throwIfAborted();
          stage = "stream";
          const chunks: Buffer[] = [];
          let bytes = 0;
          let eof = false;
          for (let reads = 0; reads < 64; reads += 1) {
            const part = await session.send("IO.read", { handle: result.stream, size: 262144 });
            signal.throwIfAborted();
            const chunk = Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8");
            bytes += chunk.byteLength;
            if (bytes > 8 * 1024 * 1024) throw new Error("input_trace_size");
            chunks.push(chunk);
            if (part.eof) { eof = true; break; }
          }
          await session.send("IO.close", { handle: result.stream });
          signal.throwIfAborted();
          if (!eof) throw new Error("input_trace_read_limit");
          const raw = Buffer.concat(chunks).toString("utf8");
          const directory = process.env.BG_INPUT_WIDGET_TRACE_DIR;
          if (directory) {
            stage = "owner-file";
            if (!path.isAbsolute(directory)) throw new Error("input_trace_directory");
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, "trace.json"), raw, { flag: "wx", mode: 0o600 });
          }
          stage = "schema";
          return summarizeInputWidgetTrace(raw, result.lost, browser);
        } finally {
          if (receive) session.off("Tracing.tracingComplete", receive);
        }
      }).catch((error: unknown) => ({
        state: "unavailable", stage,
        reason: error instanceof Error && /^input_trace_[a-z_]+$/.test(error.message) ? error.message : "protocol-or-io",
      }));
      // The diagnostic result is explicit; never replace an original assertion failure.
      return finishing;
    },
  };
}
