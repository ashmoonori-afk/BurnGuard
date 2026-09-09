import { cp } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../lib/paths";

/** New artifact/system initialization only; supplied brand font files retain priority. */
export async function copyBundledFonts(destination: string, repoRoot = resolveRepoRoot()): Promise<void> {
  await cp(path.join(repoRoot, "assets", "fonts"), path.join(destination, "fonts"), { recursive: true, force: false });
}
