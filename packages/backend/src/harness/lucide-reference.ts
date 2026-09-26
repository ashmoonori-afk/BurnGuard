import { mkdir, writeFile } from "node:fs/promises";
import { resolveWithin } from "../security/path-boundary";
import { renderLucideIconReference } from "./assets/lucide/icons";

/**
 * Project-relative path of the icon reference the deck and prototype skills tell the agent to Read.
 * It lives in the harness-owned inputs directory, which the canonical tree, publication, snapshots,
 * exports and the file index all exclude, and inside the agent's working directory so a Read needs
 * no permission and no repository checkout.
 */
export const LUCIDE_REFERENCE_REL_PATH = ".burnguard-inputs/lucide-icons.md";

/** Writes the generated reference into a prepared stage. Idempotent: the bytes are the same every turn. */
export async function provisionLucideIconReference(stageDir: string): Promise<void> {
  const [directory, file] = LUCIDE_REFERENCE_REL_PATH.split("/") as [string, string];
  await mkdir(resolveWithin(stageDir, directory), { recursive: true });
  await writeFile(resolveWithin(stageDir, directory, file), renderLucideIconReference(), "utf8");
}
