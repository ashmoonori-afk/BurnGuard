#!/usr/bin/env bun
/**
 * Compile the Windows backend and stage its portable resources alongside it.
 * Distribute the complete dist/windows folder, including resources/.
 */
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { stageRuntimeAssets } from "./package-runtime";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT_DIR = path.join(ROOT, "dist", "windows");
const OUT = path.join(OUT_DIR, "burnguard-design.exe");
const ENTRY = path.join(ROOT, "packages/backend/src/index.ts");
let stage = "preflight";

async function main() {
  if (!existsSync(ENTRY)) {
    console.error(`entry not found: ${ENTRY}`);
    process.exit(1);
  }

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log(`[build] entry:  ${ENTRY}`);
  console.log(`[build] output: ${OUT}`);
  console.log(`[build] target: bun-windows-x64`);

  const start = Date.now();
  stage = "compile";
  // --external electron/chromium-bidi: playwright-core imports both in
  // optional loaders we never hit (we only drive headless chromium).
  // Without the flags bun fails to resolve those optional modules at compile.
  // --external playwright-core: it resolves its own package.json at load time,
  // which --compile would bake as this machine's absolute path; the runtime
  // loader in services/playwright-runtime.ts reads the staged copy instead.
  await $`bun build ${ENTRY} \
    --compile \
    --target=bun-windows-x64 \
    --minify \
    --external electron \
    --external chromium-bidi \
    --external playwright-core \
    --external @napi-rs/canvas \
    --external pdfjs-dist \
    --outfile ${OUT}`.cwd(ROOT);

  stage = "resources";
  await stageRuntimeAssets(ROOT, OUT_DIR, true);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[build] done in ${elapsed}s`);
  console.log(`[build] run: ${OUT}`);
  console.log("[build] distribute the complete dist/windows folder");
}

main().catch((e) => {
  console.error(`[build] failed stage=${stage}`);
  console.error(e);
  process.exit(1);
});
