import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../lib/paths";

/** The bundle is a flat directory and fixed for the life of the process; list it once, not per call. */
const listings = new Map<string, Promise<readonly string[]>>();

function bundleListing(source: string): Promise<readonly string[]> {
  let listed = listings.get(source);
  if (!listed) {
    listed = readdir(source);
    listings.set(source, listed);
  }
  return listed;
}

/**
 * New artifact/system initialization only; supplied brand font files retain priority.
 *
 * Every design system, tutorial and project stage links `fonts/fonts.css`, so the bundle has to sit
 * beside each of them, and managed trees may not share bytes by link - `canonical-tree-manifest`
 * rejects any entry with more than one link. Copying the whole bundle on every call meant each
 * artifact stage rewrote ~8 MB it had already inherited, so the destination is listed first and only
 * the files it is actually missing are written. A complete destination costs two directory reads.
 */
export async function copyBundledFonts(destination: string, repoRoot = resolveRepoRoot()): Promise<void> {
  const source = path.join(repoRoot, "assets", "fonts");
  const target = path.join(destination, "fonts");
  const [names, existing] = await Promise.all([
    bundleListing(source),
    readdir(target).catch(() => null),
  ]);

  if (existing) {
    const present = new Set(existing);
    const missing = names.filter((name) => !present.has(name));
    if (missing.length === 0) return;
    await Promise.all(
      missing.map((name) => cp(path.join(source, name), path.join(target, name), { force: false })),
    );
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: false });
}
