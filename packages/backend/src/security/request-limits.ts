import type { MiddlewareHandler } from "hono";

const MiB = 1024 * 1024;

/** Hard ceiling handed to Bun.serve; nothing larger is read off the socket. */
export const MAX_REQUEST_BODY_BYTES = 64 * MiB;
/** Multipart intake: design-system uploads (48 MB), font files (16 MB), chat attachments (25 MiB total). */
const MULTIPART_BODY_BYTES = 64 * MiB;
/** Draw sidecars are capped at 2,000,000 characters by the route; allow UTF-8 expansion. */
const DRAW_BODY_BYTES = 4 * MiB;
/** Every other API body is JSON. */
const JSON_BODY_BYTES = 1 * MiB;
/** One user message; long pastes fit, unbounded prompts do not. */
export const MAX_USER_MESSAGE_CHARS = 200_000;

const MULTIPART_ROUTES = [
  /^\/api\/projects\/import$/,
  /^\/api\/design-systems\/upload$/,
  /^\/api\/design-systems\/[^/]+\/fonts$/,
  /^\/api\/sessions\/[^/]+\/(?:events|documents)$/,
];

export function requestBodyLimitFor(pathname: string, method: string): number {
  if (method === "POST" && MULTIPART_ROUTES.some((route) => route.test(pathname))) return MULTIPART_BODY_BYTES;
  if (method === "PUT" && /^\/api\/projects\/[^/]+\/draws\//.test(pathname)) return DRAW_BODY_BYTES;
  return JSON_BODY_BYTES;
}

function payloadTooLarge(limit: number): Response {
  return Response.json(
    { error: { code: "payload_too_large", message: `Request body exceeds ${limit} bytes.`, details: { limit } } },
    { status: 413 },
  );
}

/**
 * Enforces the per-route body ceiling before any handler parses the body.
 * A declared Content-Length is compared up front; a chunked or unknown-length
 * body is read into memory only up to the ceiling and then handed to the
 * handler as a plain buffered request, so no route can be tricked into
 * buffering more than its ceiling by omitting the length.
 */
export function createRequestBodyLimit(): MiddlewareHandler {
  return async (c, next) => {
    const body = c.req.raw.body;
    if (body === null) {
      await next();
      return;
    }
    const limit = requestBodyLimitFor(new URL(c.req.url).pathname, c.req.method);
    const declared = c.req.header("content-length");
    if (declared !== undefined && !c.req.raw.headers.has("transfer-encoding")) {
      const length = Number.parseInt(declared, 10);
      if (!Number.isFinite(length) || length > limit) return payloadTooLarge(limit);
      await next();
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return payloadTooLarge(limit);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const headers = new Headers(c.req.raw.headers);
    headers.delete("transfer-encoding");
    headers.set("content-length", String(size));
    c.req.raw = new Request(c.req.raw.url, { method: c.req.method, headers, body: Buffer.concat(chunks) });
    await next();
  };
}
