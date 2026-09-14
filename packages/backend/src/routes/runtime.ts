import { Hono } from "hono";
import { DECK_STAGE_JS } from "../runtime/deck-stage";
import { readBundledFontUrl } from "../data/bundled-fonts";

export const runtimeRoutes = new Hono();

runtimeRoutes.get("/runtime/fonts/*", async (c) => {
  const file = await readBundledFontUrl(c.req.path);
  if (!file) return c.notFound();
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": "font/woff2", "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable", ETag: `"${file.sha256}"`,
    "Access-Control-Allow-Origin": "*",
  } });
});

runtimeRoutes.get("/runtime/deck-stage.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  // No caching — the runtime ships with the binary and evolves quickly
  // during development. A stale cached copy caused an infinite-loop build
  // to persist in the browser after the server-side fix shipped. The file
  // is ~10 KB so the re-fetch cost is negligible.
  c.header("Cache-Control", "no-store");
  return c.body(DECK_STAGE_JS);
});
