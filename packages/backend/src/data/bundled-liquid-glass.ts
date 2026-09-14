import { cp } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../lib/paths";

/** New artifact initialization only; an artifact's own edited copy retains priority. */
export async function copyBundledLiquidGlass(destination: string, repoRoot = resolveRepoRoot()): Promise<void> {
  await cp(path.join(repoRoot, "assets", "liquid-glass"), path.join(destination, "liquid-glass"), { recursive: true, force: false });
}
