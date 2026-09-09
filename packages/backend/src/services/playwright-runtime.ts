import { createRequire } from "node:module";
import path from "node:path";
import type { chromium as ChromiumType } from "playwright-core";
import { resolveRepoRoot } from "../lib/paths";

/**
 * playwright-core resolves its own package.json while it loads
 * (lib/server/utils/nodePlatform.js: require.resolve("../../../package.json")).
 * Bun's --compile rewrites that call to the build machine's absolute path, so a
 * bundled copy throws on every other machine before the server listens. The
 * package therefore stays out of the bundle (--external) and is loaded from the
 * real file tree: the staged copy under resources/node_modules in a package,
 * the workspace copy in development. Same pattern as export-native-modules.ts.
 */
const runtimeRequire = createRequire(path.join(resolveRepoRoot(), "packages/backend/package.json"));

export function playwrightCoreDirectory(): string {
  return path.dirname(runtimeRequire.resolve("playwright-core/package.json"));
}

export const { chromium } = runtimeRequire("playwright-core") as { readonly chromium: typeof ChromiumType };
