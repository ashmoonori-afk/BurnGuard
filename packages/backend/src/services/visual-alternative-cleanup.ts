import { lstat, readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { assertSafeName } from "../security/path-boundary";

const CONTAINER = [".meta", "visual-alternatives"] as const;

/**
 * Lexical path of the alternatives container, or null when any component is missing or not a real
 * directory. Symlinked components are never followed, so cleanup cannot reach outside the tree it owns.
 */
async function realContainer(projectDir: string): Promise<string | null> {
  let current = projectDir;
  for (const component of CONTAINER) {
    current = path.join(current, component);
    const stats = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (stats === null || !stats.isDirectory()) return null;
  }
  return current;
}

export async function realGenerationDirectory(projectDir: string, generationId: string): Promise<string | null> {
  const container = await realContainer(projectDir);
  if (container === null) return null;
  const entry = path.join(container, assertSafeName(generationId));
  const stats = await lstat(entry).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  return stats !== null && stats.isDirectory() ? entry : null;
}

export async function removeGenerationEntry(projectDir: string, generationId: string): Promise<void> {
  const container = await realContainer(projectDir);
  if (container === null) return;
  await removeContainerEntry(container, assertSafeName(generationId));
}

async function removeContainerEntry(container: string, name: string): Promise<void> {
  const entry = path.join(container, name);
  const stats = await lstat(entry).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (stats === null) return;
  if (stats.isDirectory()) await rm(entry, { recursive: true, force: true });
  else await unlink(entry);
}

export async function removeUnownedGenerationEntries(
  projectDir: string,
  owned: ReadonlySet<string>,
): Promise<void> {
  const container = await realContainer(projectDir);
  if (container === null) return;
  for (const entry of await readdir(container)) {
    if (owned.has(entry)) continue;
    // Directory entry names are single components; they need no persisted-id validation.
    await removeContainerEntry(container, entry);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
