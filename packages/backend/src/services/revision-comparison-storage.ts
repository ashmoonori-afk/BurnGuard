import { lstatSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { resolveWithin } from "../security/path-boundary";
import { parseRevisionComparison, type EditScope, type RevisionComparison } from "@bg/shared";

export async function writeOperationScope(operationRoot: string, scope: EditScope): Promise<void> {
  await writeReceipt(resolveWithin(operationRoot, "edit-scope.json"), scope);
}

export async function writeOperationComparison(operationRoot: string, comparison: RevisionComparison): Promise<void> {
  await writeReceipt(resolveWithin(operationRoot, "revision-comparison.json"), comparison);
}

export function readOperationComparison(operationRoot: string, baseDigest: string, resultDigest?: string): RevisionComparison | null {
  try {
    const target = resolveWithin(operationRoot, "revision-comparison.json");
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) return null;
    const comparison = parseRevisionComparison(JSON.parse(readFileSync(target, "utf8")));
    return comparison.base_digest === baseDigest && (resultDigest === undefined || comparison.result_digest === resultDigest) ? comparison : null;
  } catch { return null; }
}

async function writeReceipt(target: string, value: unknown): Promise<void> {
  const handle = await open(target, "wx");
  try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}
