import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Proof that a Codex turn is still streaming, taken from Codex's own OpenTelemetry metrics.
 *
 * `codex exec --json` puts nothing on stdout while the model streams one item (reasoning, a message
 * or a large apply_patch input), and the session rollout is written only when an item completes.
 * Codex does count every model stream event it receives: `codex.sse_event` on the HTTP transport
 * and `codex.websocket.event` on the websocket transport (pings are not counted). Pointing
 * `otel.metrics_exporter` at a per-run loopback receiver turns those counters into a progress-only
 * signal. Nothing in an export is persisted or published; only its stream event count is read.
 */
const STREAM_EVENT_METRICS = new Set(["codex.sse_event", "codex.websocket.event"]);

export const CODEX_PROGRESS_HEADER = "x-burnguard-progress";
/** Codex reads the export interval only from the OTel SDK environment; its default is 60 s. */
export const CODEX_METRIC_EXPORT_INTERVAL_MS = 10_000;
const MAX_EXPORT_BYTES = 1024 * 1024;

export interface CodexProgressExporter {
  readonly endpoint: string;
  readonly token: string;
}

function list(value: unknown, key: string): readonly unknown[] {
  if (typeof value !== "object" || value === null) return [];
  const entry: unknown = Reflect.get(value, key);
  return Array.isArray(entry) ? entry : [];
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function succeeded(point: unknown): boolean {
  return list(point, "attributes").some((attribute) =>
    field(attribute, "key") === "success" && field(field(attribute, "value"), "stringValue") === "true");
}

function amount(point: unknown): number {
  const value = field(point, "asInt") ?? field(point, "asDouble");
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Successful model stream events in one OTLP/JSON metrics export (Codex exports delta sums). */
export function countStreamEvents(payload: unknown): number {
  let total = 0;
  for (const resource of list(payload, "resourceMetrics")) {
    for (const scope of list(resource, "scopeMetrics")) {
      for (const metric of list(scope, "metrics")) {
        const name = field(metric, "name");
        if (typeof name !== "string" || !STREAM_EVENT_METRICS.has(name)) continue;
        for (const point of list(field(metric, "sum"), "dataPoints")) if (succeeded(point)) total += amount(point);
      }
    }
  }
  return total;
}

function authorized(request: Request, token: string): boolean {
  const supplied = Buffer.from(request.headers.get(CODEX_PROGRESS_HEADER) ?? "");
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Accepts only this run's authenticated metric exports; an export without new stream events is not progress. */
export function codexProgressHandler(token: string, onProgress: () => void): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/metrics" || !authorized(request, token)) {
      return new Response(null, { status: 404 });
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_EXPORT_BYTES) return new Response(null, { status: 413 });
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_EXPORT_BYTES) return new Response(null, { status: 413 });
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (countStreamEvents(payload) > 0) onProgress();
    return Response.json({});
  };
}

export interface CodexProgressReceiver extends CodexProgressExporter {
  stop(): void;
}

/** One loopback receiver per run; the random token keeps other local processes from feeding it. */
export function startCodexProgressReceiver(onProgress: () => void): CodexProgressReceiver {
  const token = randomBytes(32).toString("hex");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: codexProgressHandler(token, onProgress) });
  return {
    endpoint: `http://127.0.0.1:${server.port}/v1/metrics`,
    token,
    stop: () => { server.stop(true); },
  };
}
